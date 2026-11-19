/**
 * Every read and write the API, the webhooks and the task runner make.
 *
 * Writes go through `write()`: one SQLite transaction, then (only after it
 * committed) one live-update event per changed row and any follow-up work
 * (texting an alert, sending a task to the runner). Business rules from
 * docs/app-api.md and docs/backend.md live here so every caller gets them:
 * sticky terminal task statuses, started_at / finished_at, the approval ↔
 * task interplay, alert routing, and the alerts Jarvis raises by itself.
 */
import type {
  Alert,
  AlertType,
  Appointment,
  Approval,
  ApprovalStatus,
  Call,
  CallSummary,
  ChangeType,
  Decision,
  HandbookEntry,
  RealtimeTable,
  Settings,
  ShopSummary,
  Task,
  TaskEvent,
  TaskStatus,
} from '../../src/lib/types.ts'
import type { Bus } from './bus.ts'
import type { Db } from './db.ts'
import { transaction } from './db.ts'
import { notFound, SAY, tooLate } from './errors.ts'
import type { Notify } from './routing.ts'
import { DEFAULT_PREFS, routeAlert } from './routing.ts'
import {
  toAlert,
  toAppointment,
  toApproval,
  toCall,
  toCallSummary,
  toDecision,
  toHandbookEntry,
  toSettings,
  toShop,
  toTask,
  toTaskEvent,
} from './rows.ts'
import { formatPhone, logError, newId, nowIso } from './util.ts'

type Row = Record<string, unknown>

export const LIST_LIMIT = 200
export const MEMORY_LIMIT = 500
export const ACTIVE: readonly TaskStatus[] = ['queued', 'running', 'needs_approval']
export const FINISHED: readonly TaskStatus[] = ['done', 'failed', 'cancelled']
const PROBLEM = ['missed', 'failed']

export interface Tx {
  changed(table: RealtimeTable, type: ChangeType, id: string): void
  /** Runs once the transaction has committed. Failures are logged, never thrown. */
  after(fn: () => void | Promise<void>): void
}

export interface StoreHooks {
  /** An alert was stored with this routing; deliver it when the channel is call or text. */
  deliverAlert?: (alert: Alert, notify: Notify) => void | Promise<void>
}

export type Store = ReturnType<typeof createStore>

export function createStore(db: Db, bus: Bus, hooks: StoreHooks = {}) {
  const one = (sql: string, ...params: unknown[]) => db.prepare(sql).get(...(params as never[])) as Row | undefined
  const all = (sql: string, ...params: unknown[]) => db.prepare(sql).all(...(params as never[])) as Row[]
  const run = (sql: string, ...params: unknown[]) => db.prepare(sql).run(...(params as never[]))

  /** The row as the API shows it, for a live-update event. */
  function rowFor(table: RealtimeTable, id: string): object | null {
    switch (table) {
      case 'tasks': {
        const row = one('SELECT * FROM tasks WHERE id = ?', id)
        return row ? toTask(row) : null
      }
      case 'task_events': {
        const row = one('SELECT * FROM task_events WHERE id = ?', id)
        return row ? toTaskEvent(row) : null
      }
      case 'approvals': {
        const row = one('SELECT * FROM approvals WHERE id = ?', id)
        return row ? toApproval(row) : null
      }
      case 'alerts': {
        const row = one('SELECT * FROM alerts WHERE id = ?', id)
        return row ? toAlert(row) : null
      }
      case 'calls': {
        const row = one('SELECT * FROM calls WHERE id = ?', id)
        return row ? toCallSummary(row) : null
      }
      case 'appointments': {
        const row = one('SELECT * FROM appointments WHERE id = ?', id)
        return row ? toAppointment(row) : null
      }
    }
  }

  function write<T>(fn: (tx: Tx) => T): T {
    const changes: { table: RealtimeTable; type: ChangeType; id: string }[] = []
    const afters: (() => void | Promise<void>)[] = []
    const tx: Tx = {
      changed(table, type, id) {
        const seen = changes.find((change) => change.table === table && change.id === id)
        if (!seen) changes.push({ table, type, id })
        else if (type === 'DELETE') seen.type = 'DELETE'
      },
      after(fn) {
        afters.push(fn)
      },
    }
    const result = transaction(db, () => fn(tx))
    for (const change of changes) {
      const row = change.type === 'DELETE' ? null : rowFor(change.table, change.id)
      if (change.type !== 'DELETE' && row === null) continue
      bus.publish({ ...change, row })
    }
    for (const fn of afters) {
      try {
        void Promise.resolve(fn()).catch((error) => logError('A follow-up step failed', error))
      } catch (error) {
        logError('A follow-up step failed', error)
      }
    }
    return result
  }

  // ── Settings ─────────────────────────────────────────────────────────────

  function ensureSettings(ownerId: string | null): Settings {
    const existing = one('SELECT * FROM settings LIMIT 1')
    if (!existing) {
      run(
        `INSERT INTO settings (id, owner_id, notify_phone, notification_prefs, quiet_hours_enabled,
           quiet_hours_start, quiet_hours_end, timezone, allowed_repos, updated_at)
         VALUES (?, ?, NULL, ?, 0, '22:00', '07:00', 'UTC', '[]', ?)`,
        newId(),
        ownerId,
        JSON.stringify(DEFAULT_PREFS),
        nowIso(),
      )
    } else if (ownerId !== null && existing.owner_id !== ownerId) {
      run('UPDATE settings SET owner_id = ? WHERE id = ?', ownerId, existing.id)
    }
    return getSettings()
  }

  function getSettings(): Settings {
    const row = one('SELECT * FROM settings LIMIT 1')
    if (!row) return ensureSettings(null)
    const settings = toSettings(row)
    // Fill in any alert type added after this row was written.
    settings.notification_prefs = { ...DEFAULT_PREFS, ...settings.notification_prefs }
    return settings
  }

  function saveSettings(values: Partial<Settings>): Settings {
    const current = getSettings()
    const next = { ...current, ...values, updated_at: nowIso() }
    run(
      `UPDATE settings SET notify_phone = ?, notification_prefs = ?, quiet_hours_enabled = ?,
         quiet_hours_start = ?, quiet_hours_end = ?, timezone = ?, allowed_repos = ?, updated_at = ?
       WHERE id = ?`,
      next.notify_phone,
      JSON.stringify(next.notification_prefs),
      next.quiet_hours_enabled ? 1 : 0,
      next.quiet_hours_start,
      next.quiet_hours_end,
      next.timezone,
      JSON.stringify(next.allowed_repos),
      next.updated_at,
      current.id,
    )
    return getSettings()
  }

  // ── Home ─────────────────────────────────────────────────────────────────

  function brief(from: string, to: string) {
    const row = one(
      `SELECT
         (SELECT count(*) FROM calls WHERE started_at >= :from AND started_at < :to AND outcome NOT IN ('missed', 'failed')) AS calls_answered,
         (SELECT count(*) FROM calls WHERE started_at >= :from AND started_at < :to AND outcome = 'booked') AS bookings_made,
         (SELECT count(*) FROM calls WHERE started_at >= :from AND started_at < :to AND outcome IN ('missed', 'failed')) AS missed_calls,
         (SELECT count(*) FROM tasks WHERE status = 'done' AND finished_at >= :from AND finished_at < :to) AS tasks_finished`,
      { from, to },
    ) as Row
    return {
      calls_answered: Number(row.calls_answered),
      bookings_made: Number(row.bookings_made),
      missed_calls: Number(row.missed_calls),
      tasks_finished: Number(row.tasks_finished),
    }
  }

  function listApprovals(status: ApprovalStatus | null): Approval[] {
    const rows = status
      ? all('SELECT * FROM approvals WHERE status = ? ORDER BY requested_at DESC, created_at DESC, rowid DESC LIMIT ?', status, LIST_LIMIT)
      : all('SELECT * FROM approvals ORDER BY requested_at DESC, created_at DESC, rowid DESC LIMIT ?', LIST_LIMIT)
    return rows.map(toApproval)
  }

  function getApproval(id: string): Approval | null {
    const row = one('SELECT * FROM approvals WHERE id = ?', id)
    return row ? toApproval(row) : null
  }

  /** Checks an approval can still be decided; throws the contract's 404 / 409. */
  function decidable(id: string): Approval {
    const approval = getApproval(id)
    if (!approval) throw notFound(SAY.noApproval)
    if (approval.status === 'pending' && approval.expires_at !== null && approval.expires_at <= nowIso()) {
      throw tooLate('This request has expired.')
    }
    if (approval.status !== 'pending') {
      throw tooLate(approval.status === 'expired' ? 'This request has expired.' : 'This was already decided.')
    }
    return approval
  }

  function decideApproval(id: string, decision: 'approved' | 'denied'): Approval {
    expireDueApprovals()
    return write((tx) => {
      const approval = decidable(id)
      const at = nowIso()
      run('UPDATE approvals SET status = ?, decided_at = ? WHERE id = ?', decision, at, id)
      tx.changed('approvals', 'UPDATE', id)
      const task = approval.task_id ? getTask(approval.task_id) : null
      if (task?.status === 'needs_approval') {
        if (decision === 'approved') {
          setTaskStatus(tx, task, 'running')
          addTaskEvent(tx, task.id, 'status', 'Approved by you')
        } else {
          setTaskStatus(tx, task, 'cancelled')
          addTaskEvent(tx, task.id, 'status', 'Denied by you')
        }
      }
      return getApproval(id) as Approval
    })
  }

  /** Pending approvals whose expires_at has passed become expired. */
  function expireDueApprovals(): number {
    const due = all("SELECT id FROM approvals WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at <= ?", nowIso())
    if (due.length === 0) return 0
    write((tx) => {
      for (const { id } of due) {
        run("UPDATE approvals SET status = 'expired' WHERE id = ? AND status = 'pending'", id)
        tx.changed('approvals', 'UPDATE', String(id))
      }
    })
    return due.length
  }

  function listAlerts(limit: number): Alert[] {
    return all('SELECT * FROM alerts ORDER BY created_at DESC, rowid DESC LIMIT ?', limit).map(toAlert)
  }

  function markAlertRead(id: string): void {
    write((tx) => {
      const row = one('SELECT id, read_at FROM alerts WHERE id = ?', id)
      if (!row) throw notFound(SAY.noAlert)
      if (row.read_at === null) {
        run('UPDATE alerts SET read_at = ? WHERE id = ?', nowIso(), id)
        tx.changed('alerts', 'UPDATE', id)
      }
    })
  }

  function markAllAlertsRead(): void {
    write((tx) => {
      const unread = all('SELECT id FROM alerts WHERE read_at IS NULL')
      const at = nowIso()
      for (const { id } of unread) {
        run('UPDATE alerts SET read_at = ? WHERE id = ?', at, id)
        tx.changed('alerts', 'UPDATE', String(id))
      }
    })
  }

  /** Stores an alert routed by the owner's preferences and quiet hours, then delivers it. */
  function createAlert(
    tx: Tx,
    input: {
      type: AlertType
      title: string
      body?: string | null
      shop_id?: string | null
      call_id?: string | null
      task_id?: string | null
      approval_id?: string | null
    },
  ): { id: string; notify: Notify } {
    const notify = routeAlert(getSettings(), input.type)
    const id = newId()
    let shopId = input.shop_id ?? null
    // An alert about a call belongs to that call's shop unless the sender says otherwise.
    if (!shopId && input.call_id) shopId = (one('SELECT shop_id FROM calls WHERE id = ?', input.call_id)?.shop_id as string) ?? null
    run(
      `INSERT INTO alerts (id, type, title, body, shop_id, call_id, task_id, approval_id, channel, read_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      id,
      input.type,
      input.title,
      input.body ?? null,
      shopId,
      input.call_id ?? null,
      input.task_id ?? null,
      input.approval_id ?? null,
      notify.channel,
      nowIso(),
    )
    tx.changed('alerts', 'INSERT', id)
    if (notify.channel !== 'in_app' && hooks.deliverAlert) {
      const deliver = hooks.deliverAlert
      tx.after(() => {
        const row = one('SELECT * FROM alerts WHERE id = ?', id)
        if (row) return deliver(toAlert(row), notify)
      })
    }
    return { id, notify }
  }

  // ── Receptionist ─────────────────────────────────────────────────────────

  const SHOP_SUMMARY = `
    SELECT s.*,
      (SELECT count(*) FROM calls c WHERE c.shop_id = s.id AND c.started_at >= :from AND c.started_at < :to) AS calls_today,
      (SELECT count(*) FROM calls c WHERE c.shop_id = s.id AND c.started_at >= :from AND c.started_at < :to AND c.outcome = 'booked') AS bookings_today,
      (SELECT count(*) FROM calls c WHERE c.shop_id = s.id AND c.started_at >= :from AND c.started_at < :to AND c.outcome IN ('missed', 'failed')) AS missed_today,
      (SELECT min(a.starts_at) FROM appointments a WHERE a.shop_id = s.id AND a.starts_at >= :now AND a.status IN ('booked', 'confirmed')) AS next_appointment_at
    FROM shops s`

  function toSummary(row: Row): ShopSummary {
    return {
      ...toShop(row),
      calls_today: Number(row.calls_today),
      bookings_today: Number(row.bookings_today),
      missed_today: Number(row.missed_today),
      next_appointment_at: row.next_appointment_at === null ? null : String(row.next_appointment_at),
    }
  }

  function listShops(from: string, to: string): ShopSummary[] {
    return all(`${SHOP_SUMMARY} ORDER BY s.name COLLATE NOCASE, s.id`, { from, to, now: nowIso() }).map(toSummary)
  }

  function getShop(id: string, from: string, to: string): ShopSummary {
    const row = one(`${SHOP_SUMMARY} WHERE s.id = :id`, { from, to, now: nowIso(), id })
    if (!row) throw notFound(SAY.noShop)
    return toSummary(row)
  }

  function requireShop(id: string) {
    if (!one('SELECT id FROM shops WHERE id = ?', id)) throw notFound(SAY.noShop)
  }

  function listAppointments(shopId: string): Appointment[] {
    requireShop(shopId)
    return all(
      `SELECT * FROM appointments WHERE shop_id = ? AND starts_at >= ? AND status <> 'cancelled'
       ORDER BY starts_at, id LIMIT ?`,
      shopId,
      nowIso(),
      LIST_LIMIT,
    ).map(toAppointment)
  }

  function listCalls(shopId: string, problemsOnly: boolean): CallSummary[] {
    requireShop(shopId)
    const filter = problemsOnly ? "AND outcome IN ('missed', 'failed')" : ''
    return all(`SELECT * FROM calls WHERE shop_id = ? ${filter} ORDER BY started_at DESC, rowid DESC LIMIT ?`, shopId, LIST_LIMIT).map(
      toCallSummary,
    )
  }

  function getCall(id: string): Call {
    const row = one('SELECT * FROM calls WHERE id = ?', id)
    if (!row) throw notFound(SAY.noCall)
    return toCall(row)
  }

  // ── Code ─────────────────────────────────────────────────────────────────

  function listTasks(): Task[] {
    return all('SELECT * FROM tasks ORDER BY created_at DESC, rowid DESC LIMIT ?', LIST_LIMIT).map(toTask)
  }

  function getTask(id: string): Task | null {
    const row = one('SELECT * FROM tasks WHERE id = ?', id)
    return row ? toTask(row) : null
  }

  function requireTask(id: string): Task {
    const task = getTask(id)
    if (!task) throw notFound(SAY.noTask)
    return task
  }

  function listTaskEvents(taskId: string): TaskEvent[] {
    requireTask(taskId)
    return all('SELECT * FROM task_events WHERE task_id = ? ORDER BY created_at, seq', taskId).map(toTaskEvent)
  }

  function addTaskEvent(tx: Tx, taskId: string, kind: TaskEvent['kind'], message: string, createdAt?: string): string {
    const id = newId()
    run(
      'INSERT INTO task_events (id, task_id, kind, message, created_at) VALUES (?, ?, ?, ?, ?)',
      id,
      taskId,
      kind,
      message,
      createdAt ?? nowIso(),
    )
    tx.changed('task_events', 'INSERT', id)
    return id
  }

  /**
   * Moves a task to `status` with the stamps the contract asks for. A task
   * that already finished keeps its status. Reaching done or failed raises
   * the matching alert.
   */
  function setTaskStatus(tx: Tx, task: Task, status: TaskStatus, extra: Partial<Task> = {}): Task {
    const finished = FINISHED.includes(task.status)
    const next = finished ? task.status : status
    const at = nowIso()
    const startedAt = next === 'running' && task.started_at === null ? at : task.started_at
    const finishedAt = FINISHED.includes(next) && !finished ? at : task.finished_at
    const merged = { ...task, ...extra }
    run(
      `UPDATE tasks SET status = ?, external_id = ?, title = ?, branch = ?, result_summary = ?, pr_url = ?, error = ?,
         started_at = ?, finished_at = ?, updated_at = ? WHERE id = ?`,
      next,
      merged.external_id,
      merged.title,
      merged.branch,
      merged.result_summary,
      merged.pr_url,
      merged.error,
      startedAt,
      finishedAt,
      at,
      task.id,
    )
    tx.changed('tasks', 'UPDATE', task.id)
    if (!finished && next !== task.status) {
      if (next === 'cancelled') {
        // Whatever the task was waiting on no longer matters.
        for (const { id } of all("SELECT id FROM approvals WHERE task_id = ? AND status = 'pending'", task.id)) {
          run("UPDATE approvals SET status = 'expired' WHERE id = ?", id)
          tx.changed('approvals', 'UPDATE', String(id))
        }
      }
      if (next === 'done') {
        createAlert(tx, { type: 'task_done', title: `Task finished: ${merged.title}`, body: merged.result_summary, task_id: task.id })
      }
      if (next === 'failed') {
        createAlert(tx, { type: 'task_failed', title: `Task failed: ${merged.title}`, body: merged.error, task_id: task.id })
      }
    }
    return getTask(task.id) as Task
  }

  function createTask(repo: string, instructions: string, title: string): Task {
    return write((tx) => {
      const id = newId()
      const at = nowIso()
      run(
        `INSERT INTO tasks (id, external_id, title, repo, instructions, status, created_at, updated_at)
         VALUES (?, NULL, ?, ?, ?, 'queued', ?, ?)`,
        id,
        title,
        repo,
        instructions,
        at,
        at,
      )
      tx.changed('tasks', 'INSERT', id)
      addTaskEvent(tx, id, 'status', 'Queued')
      return getTask(id) as Task
    })
  }

  function cancelTask(id: string): Task {
    return write((tx) => {
      const task = requireTask(id)
      if (!ACTIVE.includes(task.status)) throw tooLate('This task has already finished.')
      const updated = setTaskStatus(tx, task, 'cancelled')
      addTaskEvent(tx, id, 'status', 'Cancelled by you')
      return updated
    })
  }

  /** What happened when the task was handed to the runner. */
  function recordDispatch(
    id: string,
    outcome: { kind: 'accepted'; externalId: string | null } | { kind: 'not_configured' } | { kind: 'rejected'; detail: string } | { kind: 'unreachable'; detail: string },
  ): void {
    write((tx) => {
      const task = getTask(id)
      if (!task) return
      const attempts = Number(one('SELECT dispatch_attempts FROM tasks WHERE id = ?', id)?.dispatch_attempts ?? 0) + 1
      run('UPDATE tasks SET dispatch_attempts = ? WHERE id = ?', attempts, id)
      switch (outcome.kind) {
        case 'accepted':
          run('UPDATE tasks SET dispatched_at = ? WHERE id = ?', nowIso(), id)
          if (outcome.externalId && !task.external_id) {
            const taken = one('SELECT id FROM tasks WHERE external_id = ? AND id <> ?', outcome.externalId, id)
            if (!taken) setTaskStatus(tx, task, task.status, { external_id: outcome.externalId })
          }
          addTaskEvent(tx, id, 'log', 'Sent to the task runner.')
          break
        case 'not_configured':
          if (attempts === 1) addTaskEvent(tx, id, 'log', 'No task runner is connected yet. This task will wait in the queue.')
          break
        case 'rejected':
          setTaskStatus(tx, task, 'failed', { error: outcome.detail })
          addTaskEvent(tx, id, 'error', outcome.detail)
          break
        case 'unreachable':
          if (attempts === 1) addTaskEvent(tx, id, 'error', `${outcome.detail} Jarvis will keep trying every minute.`)
          break
      }
    })
  }

  /** Queued tasks the runner has not accepted yet (oldest first). */
  function undispatchedTasks(): Task[] {
    return all("SELECT * FROM tasks WHERE status = 'queued' AND dispatched_at IS NULL ORDER BY created_at, rowid LIMIT 20").map(toTask)
  }

  // ── Memory ───────────────────────────────────────────────────────────────

  function listHandbook(): HandbookEntry[] {
    return all('SELECT * FROM handbook_entries ORDER BY updated_at DESC, rowid DESC LIMIT ?', MEMORY_LIMIT).map(toHandbookEntry)
  }

  function saveHandbook(id: string | null, input: { title: string; category: string; content: string; tags: string[] }): HandbookEntry {
    const at = nowIso()
    if (id === null) {
      const newEntryId = newId()
      run(
        `INSERT INTO handbook_entries (id, title, category, content, tags, notion_page_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
        newEntryId,
        input.title,
        input.category,
        input.content,
        JSON.stringify(input.tags),
        at,
        at,
      )
      id = newEntryId
    } else {
      const result = run(
        'UPDATE handbook_entries SET title = ?, category = ?, content = ?, tags = ?, updated_at = ? WHERE id = ?',
        input.title,
        input.category,
        input.content,
        JSON.stringify(input.tags),
        at,
        id,
      )
      if (Number(result.changes) === 0) throw notFound(SAY.noEntry)
    }
    return toHandbookEntry(one('SELECT * FROM handbook_entries WHERE id = ?', id) as Row)
  }

  function deleteHandbook(id: string): void {
    if (Number(run('DELETE FROM handbook_entries WHERE id = ?', id).changes) === 0) throw notFound(SAY.noEntry)
  }

  function listDecisions(): Decision[] {
    return all('SELECT * FROM decisions ORDER BY decided_on DESC, created_at DESC, rowid DESC LIMIT ?', MEMORY_LIMIT).map(toDecision)
  }

  function saveDecision(
    id: string | null,
    input: { title: string; decision: string; rationale: string | null; decided_on: string; tags: string[] },
  ): Decision {
    const at = nowIso()
    if (id === null) {
      const newDecisionId = newId()
      run(
        `INSERT INTO decisions (id, title, decision, rationale, decided_on, tags, notion_page_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        newDecisionId,
        input.title,
        input.decision,
        input.rationale,
        input.decided_on,
        JSON.stringify(input.tags),
        at,
        at,
      )
      id = newDecisionId
    } else {
      const result = run(
        'UPDATE decisions SET title = ?, decision = ?, rationale = ?, decided_on = ?, tags = ?, updated_at = ? WHERE id = ?',
        input.title,
        input.decision,
        input.rationale,
        input.decided_on,
        JSON.stringify(input.tags),
        at,
        id,
      )
      if (Number(result.changes) === 0) throw notFound(SAY.noDecision)
    }
    return toDecision(one('SELECT * FROM decisions WHERE id = ?', id) as Row)
  }

  function deleteDecision(id: string): void {
    if (Number(run('DELETE FROM decisions WHERE id = ?', id).changes) === 0) throw notFound(SAY.noDecision)
  }

  // ── Incoming data (webhooks) ─────────────────────────────────────────────

  function findShopId(ref: { shop_id?: string; shop_phone?: string }): string | null {
    if (ref.shop_id) return (one('SELECT id FROM shops WHERE id = ?', ref.shop_id)?.id as string) ?? null
    if (ref.shop_phone) return (one('SELECT id FROM shops WHERE phone = ?', ref.shop_phone)?.id as string) ?? null
    return null
  }

  function upsertShop(input: { name: string; phone: string; address?: string; timezone?: string; status?: string }): string {
    const existing = one('SELECT * FROM shops WHERE phone = ?', input.phone)
    if (existing) {
      run(
        'UPDATE shops SET name = ?, address = ?, timezone = ?, status = ? WHERE id = ?',
        input.name,
        input.address ?? existing.address,
        input.timezone ?? existing.timezone,
        input.status ?? existing.status,
        existing.id,
      )
      return String(existing.id)
    }
    const id = newId()
    run(
      'INSERT INTO shops (id, name, phone, address, timezone, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id,
      input.name,
      input.phone,
      input.address ?? '',
      input.timezone ?? 'UTC',
      input.status ?? 'active',
      nowIso(),
    )
    return id
  }

  /**
   * Creates the call or updates the one with that external_id. Fields not
   * sent keep their value. A call that becomes missed or failed raises an alert.
   */
  function upsertCall(
    tx: Tx,
    input: {
      external_id: string
      shop_id: string
      caller_phone: string
      caller_name?: string | null
      started_at: string
      duration_seconds?: number
      outcome: string
      summary?: string | null
      transcript?: unknown[]
    },
  ): string {
    const existing = one('SELECT * FROM calls WHERE external_id = ?', input.external_id)
    let id: string
    if (existing) {
      id = String(existing.id)
      run(
        `UPDATE calls SET shop_id = ?, caller_phone = ?, caller_name = ?, started_at = ?, duration_seconds = ?,
           outcome = ?, summary = ?, transcript = ? WHERE id = ?`,
        input.shop_id,
        input.caller_phone,
        input.caller_name !== undefined ? input.caller_name : existing.caller_name,
        input.started_at,
        input.duration_seconds ?? existing.duration_seconds,
        input.outcome,
        input.summary !== undefined ? input.summary : existing.summary,
        input.transcript !== undefined ? JSON.stringify(input.transcript) : existing.transcript,
        id,
      )
      tx.changed('calls', 'UPDATE', id)
    } else {
      id = newId()
      run(
        `INSERT INTO calls (id, shop_id, external_id, caller_name, caller_phone, started_at, duration_seconds, outcome, summary, transcript, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        input.shop_id,
        input.external_id,
        input.caller_name ?? null,
        input.caller_phone,
        input.started_at,
        input.duration_seconds ?? 0,
        input.outcome,
        input.summary ?? null,
        JSON.stringify(input.transcript ?? []),
        nowIso(),
      )
      tx.changed('calls', 'INSERT', id)
    }
    const becameProblem = PROBLEM.includes(input.outcome) && !(existing && PROBLEM.includes(String(existing.outcome)))
    if (becameProblem) {
      const shop = one('SELECT name FROM shops WHERE id = ?', input.shop_id)
      const missed = input.outcome === 'missed'
      createAlert(tx, {
        type: missed ? 'missed_call' : 'failed_call',
        title: `${missed ? 'Missed call' : 'A call failed'} at ${String(shop?.name ?? 'a shop')}`,
        body: input.summary ?? `From ${input.caller_name ?? formatPhone(input.caller_phone)}.`,
        shop_id: input.shop_id,
        call_id: id,
      })
    }
    return id
  }

  function upsertAppointment(
    tx: Tx,
    input: {
      external_id: string
      shop_id: string
      call_id?: string | null
      customer_name: string
      customer_phone?: string | null
      service: string
      barber?: string | null
      starts_at: string
      duration_minutes?: number
      status?: string
      source?: string
      notes?: string | null
    },
  ): string {
    const existing = one('SELECT * FROM appointments WHERE external_id = ?', input.external_id)
    if (existing) {
      const id = String(existing.id)
      const keep = <K extends keyof typeof input>(key: K) => (input[key] !== undefined ? input[key] : existing[key])
      run(
        `UPDATE appointments SET shop_id = ?, call_id = ?, customer_name = ?, customer_phone = ?, service = ?, barber = ?,
           starts_at = ?, duration_minutes = ?, status = ?, source = ?, notes = ? WHERE id = ?`,
        input.shop_id,
        keep('call_id'),
        input.customer_name,
        keep('customer_phone'),
        input.service,
        keep('barber'),
        input.starts_at,
        keep('duration_minutes'),
        keep('status'),
        keep('source'),
        keep('notes'),
        id,
      )
      tx.changed('appointments', 'UPDATE', id)
      return id
    }
    const id = newId()
    run(
      `INSERT INTO appointments (id, shop_id, external_id, call_id, customer_name, customer_phone, service, barber,
         starts_at, duration_minutes, status, source, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.shop_id,
      input.external_id,
      input.call_id ?? null,
      input.customer_name,
      input.customer_phone ?? null,
      input.service,
      input.barber ?? null,
      input.starts_at,
      input.duration_minutes ?? 30,
      input.status ?? 'booked',
      input.source ?? 'jarvis',
      input.notes ?? null,
      nowIso(),
    )
    tx.changed('appointments', 'INSERT', id)
    return id
  }

  /** A pending approval; a queued or running task it points at starts waiting on it. */
  function requestApproval(
    tx: Tx,
    input: { kind: string; title: string; detail?: string | null; task_id?: string | null; shop_id?: string | null; expires_at?: string | null },
  ): string {
    const id = newId()
    const at = nowIso()
    run(
      `INSERT INTO approvals (id, kind, title, detail, task_id, shop_id, status, requested_at, decided_at, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, NULL, ?, ?)`,
      id,
      input.kind,
      input.title,
      input.detail ?? null,
      input.task_id ?? null,
      input.shop_id ?? null,
      at,
      input.expires_at ?? null,
      at,
    )
    tx.changed('approvals', 'INSERT', id)
    const task = input.task_id ? getTask(input.task_id) : null
    if (task && (task.status === 'queued' || task.status === 'running')) {
      setTaskStatus(tx, task, 'needs_approval')
      addTaskEvent(tx, task.id, 'status', 'Waiting for your approval')
    }
    createAlert(tx, {
      type: 'approval_needed',
      title: input.title,
      body: input.detail ?? null,
      task_id: input.task_id ?? null,
      shop_id: input.shop_id ?? null,
      approval_id: id,
    })
    return id
  }

  return {
    db,
    write,
    rowFor,
    ensureSettings,
    getSettings,
    saveSettings,
    brief,
    listApprovals,
    getApproval,
    decidable,
    decideApproval,
    expireDueApprovals,
    listAlerts,
    markAlertRead,
    markAllAlertsRead,
    createAlert,
    listShops,
    getShop,
    listAppointments,
    listCalls,
    getCall,
    listTasks,
    getTask,
    requireTask,
    listTaskEvents,
    addTaskEvent,
    setTaskStatus,
    createTask,
    cancelTask,
    recordDispatch,
    undispatchedTasks,
    listHandbook,
    saveHandbook,
    deleteHandbook,
    listDecisions,
    saveDecision,
    deleteDecision,
    findShopId,
    upsertShop,
    upsertCall,
    upsertAppointment,
    requestApproval,
  }
}
