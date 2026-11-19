/**
 * jarvis-command
 *
 * The three things the owner can ask Jarvis to do from the app. Each one is
 * a Postgres function (so the change is atomic) plus a call to the owner's
 * Jarvis backend, in the order docs/backend.md fixes:
 *
 *   create_task       save the task → hand it to the backend → record what
 *                     the backend said → answer with the final task
 *   cancel_task       cancel in the database → tell the backend (best effort)
 *   decide_approval   check it is still pending → tell the backend FIRST →
 *                     only then record the decision
 *
 *   POST { action, … }  →  200 { "task": Task } | { "approval": Approval }
 *   400 invalid · 401 unauthorized · 403 forbidden · 404 not_found ·
 *   409 invalid · 502 upstream · 503 not_configured
 *
 * Who is asking comes from the verified token and nothing else. No field of
 * the request body names a user.
 */
import { type AuthDeps, ownerEndpoint } from '../_shared/auth.ts'
import { type Db, dbErrorResponse, type Row, singleRow } from '../_shared/db.ts'
import type { Env } from '../_shared/env.ts'
import type { FetchLike } from '../_shared/fetch.ts'
import {
  errorResponse,
  internalError,
  isRecord,
  isUuid,
  jsonResponse,
  readJson,
} from '../_shared/http.ts'
import {
  type BackendResult,
  externalIdFrom,
  JARVIS_TIMEOUT_MS,
  jarvisBackend,
  jarvisConfig,
} from '../_shared/jarvis.ts'

const TAG = 'jarvis-command'

/** 8,000 characters of instructions is at most ~100 KB of JSON; leave headroom. */
const MAX_BODY_BYTES = 262_144
const MAX_INSTRUCTIONS = 8000
const MAX_REPO_LENGTH = 200
/** How long to wait on the "never mind" sent after a hand-off nobody answered. */
const FOLLOW_UP_TIMEOUT_MS = 3_000

export interface CommandDeps {
  env: Env
  fetch: FetchLike
  auth: AuthDeps
  /** The service-role database. Called only after the owner check has passed. */
  db: () => Db
  /** Overridden in tests. */
  backendTimeoutMs?: number
}

export type Command =
  | { action: 'create_task'; repo: string; instructions: string }
  | { action: 'cancel_task'; task_id: string }
  | { action: 'decide_approval'; approval_id: string; decision: 'approved' | 'denied' }

export function handleCommand(request: Request, deps: CommandDeps): Promise<Response> {
  return ownerEndpoint(request, deps.auth, TAG, async () => {
    const body = await readJson(request, MAX_BODY_BYTES)
    if (!body.ok) return body.response

    const parsed = parseCommand(body.value)
    if (!parsed.ok) return errorResponse(400, 'invalid', parsed.message)

    const db = deps.db()
    switch (parsed.command.action) {
      case 'create_task':
        return await createTask(parsed.command, db, deps)
      case 'cancel_task':
        return await cancelTask(parsed.command, db, deps)
      case 'decide_approval':
        return await decideApproval(parsed.command, db, deps)
    }
  })
}

// ── Input ───────────────────────────────────────────────────────────────────

export function parseCommand(
  body: unknown,
): { ok: true; command: Command } | { ok: false; message: string } {
  const invalid = (message: string) => ({ ok: false as const, message })
  if (!isRecord(body)) return invalid('Send a JSON object with an "action".')

  switch (body.action) {
    case 'create_task': {
      const { repo, instructions } = body
      if (typeof repo !== 'string' || repo.trim() === '') return invalid('Pick a repository.')
      if (repo.length > MAX_REPO_LENGTH) return invalid("That repository name isn't valid.")
      if (typeof instructions !== 'string' || instructions.trim() === '') {
        return invalid('Tell Jarvis what to do.')
      }
      // Counted the way Postgres counts them: by character, not by UTF-16 unit.
      if ([...instructions.trim()].length > MAX_INSTRUCTIONS) {
        return invalid('Instructions can be at most 8,000 characters.')
      }
      return { ok: true, command: { action: 'create_task', repo, instructions } }
    }
    case 'cancel_task': {
      if (!isUuid(body.task_id)) return invalid("That task id isn't valid.")
      return { ok: true, command: { action: 'cancel_task', task_id: body.task_id.toLowerCase() } }
    }
    case 'decide_approval': {
      if (!isUuid(body.approval_id)) return invalid("That approval id isn't valid.")
      if (body.decision !== 'approved' && body.decision !== 'denied') {
        return invalid('The decision must be "approved" or "denied".')
      }
      return {
        ok: true,
        command: {
          action: 'decide_approval',
          approval_id: body.approval_id.toLowerCase(),
          decision: body.decision,
        },
      }
    }
    default:
      return invalid('Unknown action. Use create_task, cancel_task or decide_approval.')
  }
}

// ── create_task ─────────────────────────────────────────────────────────────

type Dispatch =
  | { outcome: 'accepted'; externalId: string | null; detail: null; unanswered: false }
  | { outcome: 'not_configured'; externalId: null; detail: null; unanswered: false }
  /** `unanswered`: no reply at all, so the backend may have received the task anyway. */
  | { outcome: 'rejected'; externalId: null; detail: string; unanswered: boolean }

async function createTask(
  command: Extract<Command, { action: 'create_task' }>,
  db: Db,
  deps: CommandDeps,
): Promise<Response> {
  // 1. Save it. The database checks the repo against the allowed list.
  const created = await db.rpc('jarvis_create_task', {
    p_repo: command.repo,
    p_instructions: command.instructions,
  })
  if (!created.ok) return dbErrorResponse(created.error, TAG)
  const task = singleRow(created.data)
  if (!task) {
    console.error(`${TAG}: jarvis_create_task returned no task row`)
    return internalError()
  }
  const taskId = task.id as string

  // 2. Hand it to the Jarvis backend.
  const dispatch = await dispatchTask(task, deps)

  // 3. Record what happened, and answer with the task as it now stands.
  const recorded = await db.rpc('jarvis_record_dispatch', {
    p_task_id: taskId,
    p_outcome: dispatch.outcome,
    p_external_id: dispatch.externalId,
    p_detail: dispatch.detail,
  })
  let finalTask = recorded.ok ? singleRow(recorded.data) : null
  if (!finalTask) {
    // The task exists either way. Saying "failed" here would invite a second,
    // duplicate task, so answer with the freshest row we can get.
    console.error(
      `${TAG}: could not record dispatch "${dispatch.outcome}" for task ${taskId}`,
      recorded.ok ? 'no row returned' : `${recorded.error.code ?? 'no-code'}: ${recorded.error.message.slice(0, 300)}`,
    )
    const current = await db.findById('tasks', taskId, '*')
    finalTask = current.ok && current.data ? current.data : task
  }

  // 4. No reply is not the same as "no". If the backend may have taken a task
  //    the app now shows as failed, ask it to drop that task.
  if (dispatch.outcome === 'rejected' && dispatch.unanswered) {
    const config = jarvisConfig(deps.env)
    if (config.state === 'ready') {
      const followUp = await jarvisBackend(config, deps.fetch, timeout(deps)).cancelTask(
        taskId,
        FOLLOW_UP_TIMEOUT_MS,
      )
      if (!followUp.ok) logBackendFailure('cancel after unanswered hand-off', taskId, followUp)
    }
  }

  return jsonResponse({ task: finalTask })
}

async function dispatchTask(task: Row, deps: CommandDeps): Promise<Dispatch> {
  const config = jarvisConfig(deps.env)
  if (config.state === 'missing') {
    return { outcome: 'not_configured', externalId: null, detail: null, unanswered: false }
  }
  if (config.state === 'invalid') {
    return { outcome: 'rejected', externalId: null, detail: config.detail, unanswered: false }
  }

  const result = await jarvisBackend(config, deps.fetch, timeout(deps)).createTask({
    task_id: task.id as string,
    title: text(task.title),
    repo: text(task.repo),
    instructions: text(task.instructions),
  })
  if (result.ok) {
    return {
      outcome: 'accepted',
      externalId: externalIdFrom(result.body),
      detail: null,
      unanswered: false,
    }
  }
  logBackendFailure('hand-off', task.id as string, result)
  return {
    outcome: 'rejected',
    externalId: null,
    detail: result.detail,
    unanswered: result.kind !== 'status',
  }
}

// ── cancel_task ─────────────────────────────────────────────────────────────

async function cancelTask(
  command: Extract<Command, { action: 'cancel_task' }>,
  db: Db,
  deps: CommandDeps,
): Promise<Response> {
  const cancelled = await db.rpc('jarvis_cancel_task', { p_task_id: command.task_id })
  if (!cancelled.ok) return dbErrorResponse(cancelled.error, TAG)
  const task = singleRow(cancelled.data)
  if (!task) {
    console.error(`${TAG}: jarvis_cancel_task returned no task row`)
    return internalError()
  }

  // Best effort: the task is cancelled for the owner whether or not the
  // backend hears about it right now.
  const config = jarvisConfig(deps.env)
  if (config.state === 'ready') {
    const told = await jarvisBackend(config, deps.fetch, timeout(deps)).cancelTask(command.task_id)
    if (!told.ok) logBackendFailure('cancel', command.task_id, told)
  }

  return jsonResponse({ task })
}

// ── decide_approval ─────────────────────────────────────────────────────────

async function decideApproval(
  command: Extract<Command, { action: 'decide_approval' }>,
  db: Db,
  deps: CommandDeps,
): Promise<Response> {
  // 1. Is there still something to decide?
  const found = await db.findById('approvals', command.approval_id, 'id, status, task_id')
  if (!found.ok) return dbErrorResponse(found.error, TAG)
  if (!found.data) {
    return errorResponse(404, 'not_found', "That approval doesn't exist any more.")
  }
  if (found.data.status !== 'pending') {
    return errorResponse(409, 'invalid', alreadyDecided(found.data.status))
  }
  const taskId = isUuid(found.data.task_id) ? found.data.task_id : null

  // 2. The backend hears it first. If it cannot be told, nothing is recorded,
  //    so the app never shows "approved" for something Jarvis did not hear.
  const config = jarvisConfig(deps.env)
  if (config.state === 'invalid') {
    return errorResponse(503, 'not_configured', `${config.detail} Nothing was saved.`)
  }
  let backendTold = false
  if (config.state === 'ready') {
    const told = await jarvisBackend(config, deps.fetch, timeout(deps)).sendDecision(
      command.approval_id,
      command.decision,
      taskId,
    )
    if (!told.ok) {
      logBackendFailure('decision', command.approval_id, told)
      return errorResponse(
        502,
        'upstream',
        `${told.detail} Your decision was not saved, so you can try again.`,
      )
    }
    backendTold = true
  }

  // 3. Record it.
  const decided = await db.rpc('jarvis_decide_approval', {
    p_approval_id: command.approval_id,
    p_decision: command.decision,
  })
  if (!decided.ok) {
    if (backendTold) {
      console.error(
        `${TAG}: backend was told "${command.decision}" for approval ${command.approval_id} but it could not be recorded`,
      )
    }
    return dbErrorResponse(decided.error, TAG)
  }
  const approval = singleRow(decided.data)
  if (!approval) {
    console.error(`${TAG}: jarvis_decide_approval returned no approval row`)
    return internalError()
  }
  return jsonResponse({ approval })
}

function alreadyDecided(status: unknown): string {
  switch (status) {
    case 'approved':
      return 'That was already approved.'
    case 'denied':
      return 'That was already denied.'
    case 'expired':
      return 'That approval has expired.'
    default:
      return 'That approval is no longer waiting for a decision.'
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function timeout(deps: CommandDeps): number {
  return deps.backendTimeoutMs ?? JARVIS_TIMEOUT_MS
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Ids and status codes only: no instructions, no titles, no reply bodies. */
function logBackendFailure(
  what: string,
  id: string,
  result: Extract<BackendResult, { ok: false }>,
): void {
  console.error(
    `${TAG}: backend ${what} failed for ${id}`,
    result.status === null ? result.kind : `HTTP ${result.status}`,
  )
}
