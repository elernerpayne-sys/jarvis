/**
 * The demo implementation of JarvisService: a week of sample data held in
 * memory, with a small simulator so realtime updates are visible. It is what
 * the app runs on when no Supabase keys are set, and it doubles as the
 * reference for how the live backend behaves.
 *
 * Everything resets on reload. See scenario.ts for `?demo=empty|error|slow`.
 */
import { dayBounds, localDate, titleFromInstructions } from '@/lib/format'
import { ACTIVE_TASK_STATUSES, PROBLEM_OUTCOMES } from '@/lib/types'
import type {
  Alert,
  Appointment,
  Approval,
  Brief,
  Call,
  CallSummary,
  Decision,
  HandbookEntry,
  Settings,
  SettingsPatch,
  Shop,
  ShopSummary,
  Task,
  TaskEventKind,
} from '@/lib/types'
import { ServiceError } from '@/services/errors'
import type { AuthApi, AuthUser, JarvisService } from '@/services/types'

import { createIds } from './ids'
import { createRandom } from './random'
import { readScenario } from './scenario'
import type { DemoScenario } from './scenario'
import { createSchedule } from './schedule'
import { buildSeed, connectionStatuses, emptyData, shopLines } from './seed'
import { createSimulator } from './simulator'
import { copy, createStore, toCallSummary } from './store'
import { createTimers } from './timers'
import { iso } from './time'

export type { DemoScenario } from './scenario'

export interface DemoOptions {
  /** The clock. Defaults to the real one. */
  now?: () => Date
  /**
   * Simulated network delay in milliseconds for every call, or false for
   * none. Left out, reads take 150–400ms and writes 300–600ms.
   */
  latency?: number | false
  /** False keeps everything still: no running tasks, no new calls. */
  simulate?: boolean
  /** Left out, read from the page address (see scenario.ts). */
  scenario?: DemoScenario | null
  /** Same seed, same sample data. */
  seed?: number
}

export interface DemoService extends JarvisService {
  /** Stops the simulator and cancels every pending timer. */
  dispose(): void
}

const DEFAULT_SEED = 20261119
const MAX_INSTRUCTIONS = 8000
const SLOW_MS = 2500
const CONNECTION_CHECK_MS = 600
const DEMO_USER: AuthUser = { id: 'demo-owner', email: 'owner@jarvis.demo' }

const OFFLINE = 'Couldn’t reach Jarvis. Check your connection and try again.'
const VOICE_OFF = 'Voice runs on the live ElevenLabs agent. In demo mode Jarvis is simulated.'
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/

const SAY = {
  noShop: 'Couldn’t find that shop.',
  noCall: 'Couldn’t find that call.',
  noTask: 'Couldn’t find that task.',
  noApproval: 'Couldn’t find that request. It may have been withdrawn.',
  noAlert: 'Couldn’t find that alert.',
  noEntry: 'Couldn’t find that entry. It may have been deleted.',
  noDecision: 'Couldn’t find that decision. It may have been deleted.',
}

const notFound = (message: string) => new ServiceError('not_found', message)
const invalid = (message: string) => new ServiceError('invalid', message)

/** Trimmed, without blanks or repeats, in the order they were typed. */
function cleanTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter((tag) => tag !== ''))]
}

function required(value: string, message: string): string {
  const trimmed = value.trim()
  if (trimmed === '') throw invalid(message)
  return trimmed
}

function inRange(timestamp: string | null, range: { from: Date; to: Date }): boolean {
  if (!timestamp) return false
  const at = new Date(timestamp).getTime()
  return at >= range.from.getTime() && at < range.to.getTime()
}

const newestFirst = <T>(key: (row: T) => string) => (a: T, b: T) => key(b).localeCompare(key(a))

export function createDemoService(options: DemoOptions = {}): DemoService {
  const now = options.now ?? (() => new Date())
  const scenario = options.scenario !== undefined ? options.scenario : readScenario()
  const seedNumber = options.seed ?? DEFAULT_SEED
  const ids = createIds()
  const timers = createTimers()
  const startedAt = now()

  const seed = scenario === 'empty' || scenario === 'error' ? null : buildSeed({ now: startedAt, seed: seedNumber, ids })
  const store = createStore(seed?.data ?? emptyData(startedAt), ids)
  const { data } = store

  const simulator = createSimulator({
    store,
    timers,
    now,
    rng: seed?.rng ?? createRandom(seedNumber),
    writer: seed?.writer ?? null,
    schedule: createSchedule(data.appointments),
    plans: seed?.plans ?? new Map(),
  })
  const simulating = options.simulate !== false && scenario !== 'error'
  if (simulating) simulator.start()

  // ── Timing ───────────────────────────────────────────────────────────────
  // Delays use their own random stream so the sample data and the simulator
  // stay the same however many reads a screen makes.
  const jitter = createRandom(seedNumber ^ 0x5bd1e995)

  function delay(kind: 'read' | 'write'): number {
    if (options.latency === false) return 0
    if (typeof options.latency === 'number') return options.latency
    if (scenario === 'slow' && kind === 'read') return SLOW_MS + jitter.int(-150, 150)
    return kind === 'read' ? jitter.int(150, 400) : jitter.int(300, 600)
  }

  async function respond<T>(kind: 'read' | 'write', work: () => T): Promise<T> {
    await timers.sleep(delay(kind))
    if (scenario === 'error') throw new ServiceError('network', OFFLINE)
    return copy(work())
  }

  const read = <T>(work: () => T) => respond('read', work)
  const write = <T>(work: () => T) => respond('write', work)

  // ── Lookups ──────────────────────────────────────────────────────────────
  function findShop(id: string): Shop {
    const shop = data.shops.find((row) => row.id === id)
    if (!shop) throw notFound(SAY.noShop)
    return shop
  }

  function findTask(id: string): Task {
    const task = store.find('tasks', id)
    if (!task) throw notFound(SAY.noTask)
    return task
  }

  function logEvent(taskId: string, kind: TaskEventKind, message: string): void {
    store.insert('task_events', { id: ids.next('event'), task_id: taskId, kind, message, created_at: iso(now()) })
  }

  /** Today's numbers for one shop, counted from the same rows the lists show. */
  function summarize(shop: Shop): ShopSummary {
    const today = dayBounds(now())
    const calls = data.calls.filter((call) => call.shop_id === shop.id && inRange(call.started_at, today))
    const nowMs = now().getTime()
    const next = data.appointments
      .filter(
        (appointment) =>
          appointment.shop_id === shop.id &&
          (appointment.status === 'booked' || appointment.status === 'confirmed') &&
          new Date(appointment.starts_at).getTime() >= nowMs,
      )
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0]
    return {
      ...shop,
      calls_today: calls.length,
      bookings_today: calls.filter((call) => call.outcome === 'booked').length,
      missed_today: calls.filter((call) => PROBLEM_OUTCOMES.includes(call.outcome)).length,
      next_appointment_at: next?.starts_at ?? null,
    }
  }

  // ── Auth ─────────────────────────────────────────────────────────────────
  const auth: AuthApi = {
    getUser: async () => ({ ...DEMO_USER }),
    // Demo mode is always signed in; there is nothing to report.
    onChange: () => () => {},
    signInWithPassword: async () => {},
    sendEmailCode: async () => {},
    verifyEmailCode: async () => {},
    signOut: async () => {},
  }

  return {
    mode: 'demo',
    auth,

    // ── Home ───────────────────────────────────────────────────────────────
    getBrief: () =>
      read((): Brief => {
        const today = dayBounds(now())
        const calls = data.calls.filter((call) => inRange(call.started_at, today))
        const problems = calls.filter((call) => PROBLEM_OUTCOMES.includes(call.outcome)).length
        return {
          date: localDate(now()),
          calls_answered: calls.length - problems,
          bookings_made: calls.filter((call) => call.outcome === 'booked').length,
          missed_calls: problems,
          tasks_finished: data.tasks.filter((task) => task.status === 'done' && inRange(task.finished_at, today)).length,
        }
      }),

    listApprovals: (filter) =>
      read((): Approval[] =>
        data.approvals
          .filter((approval) => !filter?.status || approval.status === filter.status)
          .sort(newestFirst((approval) => approval.requested_at)),
      ),

    decideApproval: (id, decision) =>
      write((): Approval => {
        const approval = store.find('approvals', id)
        if (!approval) throw notFound(SAY.noApproval)
        if (decision !== 'approved' && decision !== 'denied') throw invalid('Choose approve or deny.')
        if (approval.status !== 'pending') {
          throw invalid(approval.status === 'expired' ? 'This request has expired.' : 'This was already decided.')
        }
        const at = iso(now())
        const decided = store.update('approvals', id, { status: decision, decided_at: at }) ?? approval
        const task = approval.task_id ? store.find('tasks', approval.task_id) : undefined
        if (task?.status === 'needs_approval') {
          if (decision === 'approved') {
            store.update('tasks', task.id, { status: 'running', updated_at: at })
            logEvent(task.id, 'status', 'Approved by you')
          } else {
            store.update('tasks', task.id, { status: 'cancelled', updated_at: at, finished_at: at })
            logEvent(task.id, 'status', 'Denied by you')
            simulator.taskCancelled(task.id)
          }
        }
        if (simulating) simulator.approvalDecided(decided)
        return decided
      }),

    listAlerts: (filter) =>
      read((): Alert[] => {
        const sorted = [...data.alerts].sort(newestFirst((alert) => alert.created_at))
        return filter?.limit === undefined ? sorted : sorted.slice(0, Math.max(0, filter.limit))
      }),

    markAlertRead: (id) =>
      write(() => {
        const alert = store.find('alerts', id)
        if (!alert) throw notFound(SAY.noAlert)
        if (!alert.read_at) store.update('alerts', id, { read_at: iso(now()) })
      }),

    markAllAlertsRead: () =>
      write(() => {
        const at = iso(now())
        for (const alert of data.alerts.filter((row) => !row.read_at)) {
          store.update('alerts', alert.id, { read_at: at })
        }
      }),

    // ── Receptionist ───────────────────────────────────────────────────────
    listShops: () =>
      read((): ShopSummary[] => [...data.shops].sort((a, b) => a.name.localeCompare(b.name)).map(summarize)),

    getShop: (id) => read(() => summarize(findShop(id))),

    listUpcomingAppointments: (shopId) =>
      read((): Appointment[] => {
        const nowMs = now().getTime()
        return data.appointments
          .filter(
            (appointment) =>
              appointment.shop_id === shopId &&
              appointment.status !== 'cancelled' &&
              new Date(appointment.starts_at).getTime() >= nowMs,
          )
          .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      }),

    listCalls: (shopId, filter) =>
      read((): CallSummary[] =>
        data.calls
          .filter((call) => call.shop_id === shopId)
          .filter((call) => filter?.filter !== 'problems' || PROBLEM_OUTCOMES.includes(call.outcome))
          .sort(newestFirst((call) => call.started_at))
          .map(toCallSummary),
      ),

    getCall: (id) =>
      read((): Call => {
        const call = store.find('calls', id)
        if (!call) throw notFound(SAY.noCall)
        return call
      }),

    // ── Code ───────────────────────────────────────────────────────────────
    listAllowedRepos: () => read(() => data.settings.allowed_repos),

    listTasks: () => read((): Task[] => [...data.tasks].sort(newestFirst((task) => task.created_at))),

    getTask: (id) => read(() => findTask(id)),

    listTaskEvents: (taskId) =>
      read(() =>
        data.task_events
          .filter((event) => event.task_id === taskId)
          .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)),
      ),

    createTask: (input) =>
      write((): Task => {
        const repo = input.repo.trim()
        if (!data.settings.allowed_repos.includes(repo)) {
          throw invalid(
            repo === ''
              ? 'Pick a repo for Jarvis to work in.'
              : `Jarvis can’t work in ${repo}. Pick one of your allowed repos, or add it in Settings.`,
          )
        }
        const instructions = input.instructions.trim()
        if (instructions === '') throw invalid('Write what you want Jarvis to do.')
        if (instructions.length > MAX_INSTRUCTIONS) {
          throw invalid(
            `Keep the instructions under ${MAX_INSTRUCTIONS.toLocaleString('en-US')} characters. These are ${instructions.length.toLocaleString('en-US')}.`,
          )
        }
        const at = iso(now())
        const task = store.insert('tasks', {
          id: ids.next('task'),
          external_id: null,
          title: titleFromInstructions(instructions),
          repo,
          instructions,
          status: 'queued',
          branch: null,
          result_summary: null,
          pr_url: null,
          error: null,
          created_at: at,
          updated_at: at,
          started_at: null,
          finished_at: null,
        })
        logEvent(task.id, 'status', 'Queued')
        if (simulating) simulator.taskCreated(task.id)
        return task
      }),

    cancelTask: (id) =>
      write((): Task => {
        const task = findTask(id)
        if (!ACTIVE_TASK_STATUSES.includes(task.status)) throw invalid('This task has already finished.')
        const at = iso(now())
        simulator.taskCancelled(id)
        for (const approval of data.approvals) {
          if (approval.task_id === id && approval.status === 'pending') {
            store.update('approvals', approval.id, { status: 'expired' })
          }
        }
        logEvent(id, 'status', 'Cancelled by you')
        return store.update('tasks', id, { status: 'cancelled', updated_at: at, finished_at: at }) ?? task
      }),

    // ── Memory ─────────────────────────────────────────────────────────────
    listHandbookEntries: () =>
      read((): HandbookEntry[] => [...data.handbook_entries].sort(newestFirst((entry) => entry.updated_at))),

    saveHandbookEntry: (input) =>
      write((): HandbookEntry => {
        const values = {
          title: required(input.title, 'Give the entry a title.'),
          category: input.category.trim(),
          content: input.content.trim(),
          tags: cleanTags(input.tags),
        }
        const at = iso(now())
        if (input.id === undefined) {
          const entry: HandbookEntry = {
            id: ids.next('entry'),
            ...values,
            notion_page_id: null,
            created_at: at,
            updated_at: at,
          }
          data.handbook_entries.push(entry)
          return entry
        }
        const entry = data.handbook_entries.find((row) => row.id === input.id)
        if (!entry) throw notFound(SAY.noEntry)
        return Object.assign(entry, values, { updated_at: at })
      }),

    deleteHandbookEntry: (id) =>
      write(() => {
        const index = data.handbook_entries.findIndex((row) => row.id === id)
        if (index === -1) throw notFound(SAY.noEntry)
        data.handbook_entries.splice(index, 1)
      }),

    listDecisions: () =>
      read((): Decision[] =>
        [...data.decisions].sort(
          (a, b) => b.decided_on.localeCompare(a.decided_on) || b.created_at.localeCompare(a.created_at),
        ),
      ),

    saveDecision: (input) =>
      write((): Decision => {
        const decidedOn = input.decided_on.trim()
        if (!CALENDAR_DATE.test(decidedOn)) throw invalid('Pick the date this was decided.')
        const values = {
          title: required(input.title, 'Give the decision a title.'),
          decision: required(input.decision, 'Write down what was decided.'),
          rationale: input.rationale?.trim() || null,
          decided_on: decidedOn,
          tags: cleanTags(input.tags),
        }
        const at = iso(now())
        if (input.id === undefined) {
          const decision: Decision = {
            id: ids.next('decision'),
            ...values,
            notion_page_id: null,
            created_at: at,
            updated_at: at,
          }
          data.decisions.push(decision)
          return decision
        }
        const decision = data.decisions.find((row) => row.id === input.id)
        if (!decision) throw notFound(SAY.noDecision)
        return Object.assign(decision, values, { updated_at: at })
      }),

    deleteDecision: (id) =>
      write(() => {
        const index = data.decisions.findIndex((row) => row.id === id)
        if (index === -1) throw notFound(SAY.noDecision)
        data.decisions.splice(index, 1)
      }),

    // ── Settings ───────────────────────────────────────────────────────────
    getSettings: () => read(() => data.settings),

    updateSettings: (patch) =>
      write((): Settings => {
        data.settings = applySettingsPatch(data.settings, patch, iso(now()))
        return data.settings
      }),

    getConnections: async () => {
      // Long enough that "Checking…" is visible.
      await timers.sleep(options.latency === false ? 0 : (options.latency ?? CONNECTION_CHECK_MS))
      return read(() => connectionStatuses(now(), shopLines(data)))
    },

    // ── Voice ──────────────────────────────────────────────────────────────
    getVoiceSession: async () => {
      await timers.sleep(delay('read'))
      throw new ServiceError('not_configured', VOICE_OFF)
    },

    // ── Realtime ───────────────────────────────────────────────────────────
    subscribe(tables, onChange, onStatus) {
      let open = true
      const stopListening = store.listen(tables, (event) => {
        if (open) onChange(event)
      })
      void Promise.resolve().then(() => {
        if (open) onStatus?.('connecting')
      })
      const cancelLive = timers.after(options.latency === false ? 0 : 300, () => {
        if (open) onStatus?.(scenario === 'error' ? 'offline' : 'live')
      })
      return () => {
        open = false
        stopListening()
        cancelLive()
      }
    },

    dispose() {
      timers.clear()
    },
  }
}

/** Merges the fields the owner may change, cleaned the way the live service cleans them. */
function applySettingsPatch(current: Settings, patch: SettingsPatch, at: string): Settings {
  const next: Settings = { ...current, updated_at: at }
  if (patch.notify_phone !== undefined) next.notify_phone = patch.notify_phone?.trim() || null
  if (patch.notification_prefs !== undefined) {
    next.notification_prefs = { ...current.notification_prefs, ...patch.notification_prefs }
  }
  if (patch.quiet_hours_enabled !== undefined) next.quiet_hours_enabled = patch.quiet_hours_enabled
  if (patch.quiet_hours_start !== undefined) next.quiet_hours_start = patch.quiet_hours_start
  if (patch.quiet_hours_end !== undefined) next.quiet_hours_end = patch.quiet_hours_end
  if (patch.timezone !== undefined) next.timezone = patch.timezone
  if (patch.allowed_repos !== undefined) {
    next.allowed_repos = [...new Set(patch.allowed_repos.map((repo) => repo.trim()).filter((repo) => repo !== ''))]
  }
  return next
}
