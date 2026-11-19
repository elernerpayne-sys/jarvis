/**
 * Every /app endpoint in docs/app-api.md. The router (server.ts) has already
 * checked the bearer token for everything registered here.
 */
import type { AlertType, ApprovalStatus, NotifyChannel, Settings } from '../../src/lib/types.ts'
import type { Config } from './config.ts'
import { invalid, upstream } from './errors.ts'
import type { Context, createRouter } from './http.ts'
import { readJson } from './http.ts'
import { ALERT_TYPES, CHANNELS } from './routing.ts'
import type { Dispatcher } from './dispatch.ts'
import type { TaskRunner } from './services.ts'
import { checkConnections, runnerProblem, signedVoiceUrl, taskRunner } from './services.ts'
import type { Store } from './store.ts'
import { cleanList, E164, isCalendarDate, isRecord, log, logError, titleFromInstructions, toIso } from './util.ts'

export const APP_BODY_LIMIT = 256 * 1024
const MAX_INSTRUCTIONS = 8000
const REPO = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const APPROVAL_STATUSES: readonly ApprovalStatus[] = ['pending', 'approved', 'denied', 'expired']

/** A handler's answer when it isn't a plain 200. */
export class Reply {
  status: number
  body: unknown
  constructor(status: number, body?: unknown) {
    this.status = status
    this.body = body
  }
}

/** `from` / `to` for today's counters. Both optional (default: the current UTC day); a bad value is a 400. */
function dayRange(query: URLSearchParams): { from: string; to: string } {
  const rawFrom = query.get('from')
  const rawTo = query.get('to')
  if (rawFrom === null && rawTo === null) {
    const start = new Date()
    start.setUTCHours(0, 0, 0, 0)
    return { from: start.toISOString(), to: new Date(start.getTime() + 86_400_000).toISOString() }
  }
  const from = toIso(rawFrom)
  const to = toIso(rawTo)
  if (!from || !to) throw invalid('Send from and to as ISO-8601 times with a timezone.')
  if (to <= from) throw invalid('"to" must be after "from".')
  return { from, to }
}

function text(value: unknown, field: string, max: number): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw invalid(`${field} must be text.`)
  const trimmed = value.trim()
  if (trimmed.length > max) throw invalid(`Keep the ${field} under ${max.toLocaleString('en-US')} characters.`)
  return trimmed
}

function tags(value: unknown): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== 'string')) throw invalid('Tags must be a list of words.')
  const list = cleanList(value as string[])
  if (list.length > 50) throw invalid('Use at most 50 tags.')
  if (list.some((tag) => tag.length > 60)) throw invalid('Keep each tag under 60 characters.')
  return list
}

function handbookInput(body: Record<string, unknown>) {
  const title = text(body.title, 'title', 200)
  if (title === '') throw invalid('Give the entry a title.')
  // notion_page_id is never taken from the app: only the Notion sync sets it.
  return {
    title,
    category: text(body.category, 'category', 100) || 'General',
    content: text(body.content, 'content', 50_000),
    tags: tags(body.tags),
  }
}

function decisionInput(body: Record<string, unknown>) {
  const title = text(body.title, 'title', 200)
  if (title === '') throw invalid('Give the decision a title.')
  const decision = text(body.decision, 'decision', 20_000)
  if (decision === '') throw invalid('Write down what was decided.')
  if (body.rationale !== undefined && body.rationale !== null && typeof body.rationale !== 'string') {
    throw invalid('The rationale must be text.')
  }
  const rationale = text(body.rationale, 'rationale', 20_000) || null
  const decidedOn = typeof body.decided_on === 'string' ? body.decided_on.trim() : ''
  if (!isCalendarDate(decidedOn)) throw invalid('Pick the date this was decided.')
  return { title, decision, rationale, decided_on: decidedOn, tags: tags(body.tags) }
}

function validTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

/** Only the documented fields, each checked; everything else (owner_id, id, updated_at…) is ignored. */
export function settingsPatch(body: Record<string, unknown>, current: Settings): Partial<Settings> {
  const patch: Partial<Settings> = {}
  if ('notify_phone' in body) {
    const value = body.notify_phone
    if (value === null || (typeof value === 'string' && value.trim() === '')) patch.notify_phone = null
    else if (typeof value === 'string' && E164.test(value.trim())) patch.notify_phone = value.trim()
    else throw invalid('Your phone number must be in international format, like +15125550142.')
  }
  if ('notification_prefs' in body) {
    const value = body.notification_prefs
    if (!isRecord(value)) throw invalid('Notification preferences must map each alert type to call, text or in_app.')
    const merged = { ...current.notification_prefs }
    for (const [type, channel] of Object.entries(value)) {
      if (!ALERT_TYPES.includes(type as AlertType)) throw invalid(`“${type.slice(0, 40)}” isn’t an alert type.`)
      if (!CHANNELS.includes(channel as NotifyChannel)) throw invalid(`Choose call, text or in_app for ${type}.`)
      merged[type as AlertType] = channel as NotifyChannel
    }
    patch.notification_prefs = merged
  }
  if ('quiet_hours_enabled' in body) {
    if (typeof body.quiet_hours_enabled !== 'boolean') throw invalid('Quiet hours must be on or off (true or false).')
    patch.quiet_hours_enabled = body.quiet_hours_enabled
  }
  for (const key of ['quiet_hours_start', 'quiet_hours_end'] as const) {
    if (key in body) {
      const value = body[key]
      if (typeof value !== 'string' || !HHMM.test(value)) {
        throw invalid(`The quiet hours ${key.endsWith('start') ? 'start' : 'end'} must be a 24-hour time like 22:00.`)
      }
      patch[key] = value
    }
  }
  if ('timezone' in body) {
    const value = typeof body.timezone === 'string' ? body.timezone.trim() : ''
    if (value === '' || value.length > 64 || !validTimezone(value)) throw invalid('Pick a time zone such as America/Chicago.')
    patch.timezone = value
  }
  if ('allowed_repos' in body) {
    const value = body.allowed_repos
    if (!Array.isArray(value) || value.some((repo) => typeof repo !== 'string')) {
      throw invalid('Allowed repos must be a list like ["owner/name"].')
    }
    const repos = cleanList(value as string[])
    const bad = repos.find((repo) => !REPO.test(repo) || repo.length > 140)
    if (bad) throw invalid(`“${bad.slice(0, 60)}” isn’t a repo. Write it as owner/name.`)
    if (repos.length > 100) throw invalid('Allow at most 100 repos.')
    patch.allowed_repos = repos
  }
  return patch
}

export function registerAppRoutes(
  router: ReturnType<typeof createRouter>,
  deps: { store: Store; config: Config; dispatcher: Dispatcher },
): void {
  const { store, config, dispatcher } = deps
  const runner = (): TaskRunner | null => taskRunner(config)
  const body = (context: Context) => readJson(context.req, APP_BODY_LIMIT)

  // ── Home ─────────────────────────────────────────────────────────────────
  router.add('GET', '/app/brief', ({ query }) => {
    const { from, to } = dayRange(query)
    return store.brief(from, to)
  })

  router.add('GET', '/app/approvals', ({ query }) => {
    const status = query.get('status')
    if (status !== null && status !== '' && !APPROVAL_STATUSES.includes(status as ApprovalStatus)) {
      throw invalid('Status must be pending, approved, denied or expired.')
    }
    store.expireDueApprovals()
    return { approvals: store.listApprovals(status ? (status as ApprovalStatus) : null) }
  })

  router.add('POST', '/app/approvals/:id/decision', async (context) => {
    const { decision } = await body(context)
    store.expireDueApprovals()
    const approval = store.decidable(context.params.id)
    if (decision !== 'approved' && decision !== 'denied') throw invalid('Choose approve or deny.')
    // The runner owns task approvals: it hears the answer first, and if it can't, nothing is recorded.
    const taskRunnerClient = runner()
    if (approval.task_id && taskRunnerClient) {
      const outcome = await taskRunnerClient.decide(approval.id, decision, approval.task_id)
      if (outcome.kind !== 'response' || !outcome.ok) {
        logError(`approvals: the runner didn't take the decision (${outcome.kind === 'response' ? `HTTP ${outcome.status}` : outcome.kind})`)
        const reason = runnerProblem(outcome)
        throw upstream(`Nothing was changed: ${reason}`)
      }
    }
    return { approval: store.decideApproval(approval.id, decision) }
  })

  router.add('GET', '/app/alerts', ({ query }) => {
    const raw = query.get('limit')
    let limit = 50
    if (raw !== null && raw !== '') {
      const parsed = Number(raw)
      if (!Number.isInteger(parsed)) throw invalid('Limit must be a whole number from 1 to 200.')
      limit = Math.min(200, Math.max(1, parsed))
    }
    return { alerts: store.listAlerts(limit) }
  })
  router.add('POST', '/app/alerts/read-all', () => {
    store.markAllAlertsRead()
    return new Reply(204)
  })
  router.add('POST', '/app/alerts/:id/read', ({ params }) => {
    store.markAlertRead(params.id)
    return new Reply(204)
  })

  // ── Receptionist ─────────────────────────────────────────────────────────
  router.add('GET', '/app/shops', ({ query }) => {
    const { from, to } = dayRange(query)
    return { shops: store.listShops(from, to) }
  })
  router.add('GET', '/app/shops/:id', ({ params, query }) => {
    const { from, to } = dayRange(query)
    return { shop: store.getShop(params.id, from, to) }
  })
  router.add('GET', '/app/shops/:id/appointments', ({ params }) => ({ appointments: store.listAppointments(params.id) }))
  router.add('GET', '/app/shops/:id/calls', ({ params, query }) => {
    const filter = query.get('filter') ?? 'all'
    if (filter !== 'all' && filter !== 'problems' && filter !== '') throw invalid('Filter must be all or problems.')
    return { calls: store.listCalls(params.id, filter === 'problems') }
  })
  router.add('GET', '/app/calls/:id', ({ params }) => ({ call: store.getCall(params.id) }))

  // ── Code ─────────────────────────────────────────────────────────────────
  router.add('GET', '/app/repos', () => ({ repos: store.getSettings().allowed_repos }))
  router.add('GET', '/app/tasks', () => ({ tasks: store.listTasks() }))
  router.add('GET', '/app/tasks/:id', ({ params }) => ({ task: store.requireTask(params.id) }))
  router.add('GET', '/app/tasks/:id/events', ({ params }) => ({ events: store.listTaskEvents(params.id) }))

  router.add('POST', '/app/tasks', async (context) => {
    const input = await body(context)
    const repo = typeof input.repo === 'string' ? input.repo.trim() : ''
    if (repo === '') throw invalid('Pick a repo for Jarvis to work in.')
    if (!store.getSettings().allowed_repos.includes(repo)) {
      throw invalid(`Jarvis can’t work in ${repo.slice(0, 140)}. Pick one of your allowed repos, or add it in Settings.`)
    }
    const instructions = typeof input.instructions === 'string' ? input.instructions.trim() : ''
    if (instructions === '') throw invalid('Write what you want Jarvis to do.')
    if (instructions.length > MAX_INSTRUCTIONS) throw invalid('Keep the instructions under 8,000 characters.')
    const task = store.createTask(repo, instructions, titleFromInstructions(instructions))
    dispatcher.dispatchSoon(task.id)
    return new Reply(201, { task })
  })

  router.add('POST', '/app/tasks/:id/cancel', ({ params }) => {
    const task = store.cancelTask(params.id)
    const taskRunnerClient = runner()
    if (taskRunnerClient) {
      // Best effort: the task is cancelled here whatever the runner says.
      void taskRunnerClient.cancel(task.id).then((outcome) => {
        if (outcome.kind !== 'response' || !outcome.ok) {
          logError(`tasks: the runner didn't confirm the cancel (${outcome.kind === 'response' ? `HTTP ${outcome.status}` : outcome.kind})`)
        }
      })
    }
    return { task }
  })

  // ── Memory ───────────────────────────────────────────────────────────────
  router.add('GET', '/app/handbook', () => ({ entries: store.listHandbook() }))
  router.add('POST', '/app/handbook', async (context) => new Reply(201, { entry: store.saveHandbook(null, handbookInput(await body(context))) }))
  router.add('PUT', '/app/handbook/:id', async (context) => ({
    entry: store.saveHandbook(context.params.id, handbookInput(await body(context))),
  }))
  router.add('DELETE', '/app/handbook/:id', ({ params }) => {
    store.deleteHandbook(params.id)
    return new Reply(204)
  })
  router.add('GET', '/app/decisions', () => ({ decisions: store.listDecisions() }))
  router.add('POST', '/app/decisions', async (context) => new Reply(201, { decision: store.saveDecision(null, decisionInput(await body(context))) }))
  router.add('PUT', '/app/decisions/:id', async (context) => ({
    decision: store.saveDecision(context.params.id, decisionInput(await body(context))),
  }))
  router.add('DELETE', '/app/decisions/:id', ({ params }) => {
    store.deleteDecision(params.id)
    return new Reply(204)
  })

  // ── Settings ─────────────────────────────────────────────────────────────
  router.add('GET', '/app/settings', () => ({ settings: store.getSettings() }))
  router.add('PATCH', '/app/settings', async (context) => {
    const patch = settingsPatch(await body(context), store.getSettings())
    if (Object.keys(patch).length === 0) return { settings: store.getSettings() }
    return { settings: store.saveSettings(patch) }
  })

  router.add('GET', '/app/connections', async () => ({ connections: await checkConnections(config, store.db) }))

  // ── Voice ────────────────────────────────────────────────────────────────
  router.add('POST', '/app/voice/session', async () => {
    const signedUrl = await signedVoiceUrl(config)
    log('voice: signed link issued')
    return { signed_url: signedUrl }
  })
}

export function isReply(value: unknown): value is Reply {
  return value instanceof Reply
}
