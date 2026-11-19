/**
 * One endpoint per JarvisService method. Paths, query parameters and bodies
 * are exactly the ones in docs/app-api.md.
 */
import { dayBounds, localDate } from '@/lib/format'
import type {
  Alert,
  Appointment,
  Approval,
  Call,
  CallSummary,
  Decision,
  HandbookEntry,
  Settings,
  SettingsPatch,
  ShopSummary,
  Task,
  TaskEvent,
} from '@/lib/types'
import { ServiceError } from '@/services/errors'
import type { JarvisService } from '@/services/types'

import { connections } from './connections'
import { unreadable } from './errors'
import type { HttpClient } from './http'

type Methods = Omit<JarvisService, 'mode' | 'auth' | 'subscribe'>

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Fields of Settings the owner may change; anything else on a patch is dropped. */
const EDITABLE: readonly (keyof SettingsPatch)[] = [
  'notify_phone',
  'notification_prefs',
  'quiet_hours_enabled',
  'quiet_hours_start',
  'quiet_hours_end',
  'timezone',
  'allowed_repos',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** `{ "<key>": [...] }`. A bare array is accepted too. */
function list<T>(body: unknown, key: string): T[] {
  const value = Array.isArray(body) ? body : isRecord(body) ? body[key] : undefined
  if (!Array.isArray(value)) throw unreadable(body)
  return value as T[]
}

/** `{ "<key>": { ... } }`. The bare object is accepted too. */
function row<T>(body: unknown, key: string): T {
  const value = isRecord(body) && isRecord(body[key]) ? body[key] : body
  if (!isRecord(value) || value.id === undefined) throw unreadable(body)
  return value as T
}

function count(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

/** Today on this device: `from` inclusive, `to` exclusive. */
function today() {
  const { from, to } = dayBounds(new Date())
  return { from: from.toISOString(), to: to.toISOString() }
}

const id = (value: string) => encodeURIComponent(value)

function cleanTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter((tag) => tag !== ''))]
}

function required(value: string, message: string): string {
  const trimmed = value.trim()
  if (trimmed === '') throw new ServiceError('invalid', message)
  return trimmed
}

function editable(patch: SettingsPatch): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const key of EDITABLE) {
    if (patch[key] !== undefined) values[key] = patch[key]
  }
  if (typeof values.notify_phone === 'string') values.notify_phone = values.notify_phone.trim() || null
  if (Array.isArray(patch.allowed_repos)) values.allowed_repos = cleanTags(patch.allowed_repos)
  return values
}

export function createMethods(client: HttpClient): Methods {
  const get = (path: string, query?: Record<string, string | number | undefined>) =>
    client.request('GET', path, { query })
  const post = (path: string, body: unknown = {}) => client.request('POST', path, { body })
  const put = (path: string, body: unknown) => client.request('PUT', path, { body })

  return {
    // ── Home ───────────────────────────────────────────────────────────────
    async getBrief() {
      const body = await get('/app/brief', today())
      if (!isRecord(body)) throw unreadable(body)
      return {
        date: localDate(new Date()),
        calls_answered: count(body.calls_answered),
        bookings_made: count(body.bookings_made),
        missed_calls: count(body.missed_calls),
        tasks_finished: count(body.tasks_finished),
      }
    },
    listApprovals: async (options) => list<Approval>(await get('/app/approvals', { status: options?.status }), 'approvals'),
    decideApproval: async (approvalId, decision) =>
      row<Approval>(await post(`/app/approvals/${id(approvalId)}/decision`, { decision }), 'approval'),
    listAlerts: async (options) => list<Alert>(await get('/app/alerts', { limit: options?.limit }), 'alerts'),
    async markAlertRead(alertId) {
      await post(`/app/alerts/${id(alertId)}/read`)
    },
    async markAllAlertsRead() {
      await post('/app/alerts/read-all')
    },

    // ── Receptionist ───────────────────────────────────────────────────────
    listShops: async () => list<ShopSummary>(await get('/app/shops', today()), 'shops'),
    getShop: async (shopId) => row<ShopSummary>(await get(`/app/shops/${id(shopId)}`, today()), 'shop'),
    listUpcomingAppointments: async (shopId) =>
      list<Appointment>(await get(`/app/shops/${id(shopId)}/appointments`), 'appointments'),
    listCalls: async (shopId, options) =>
      list<CallSummary>(await get(`/app/shops/${id(shopId)}/calls`, { filter: options?.filter ?? 'all' }), 'calls'),
    async getCall(callId) {
      const call = row<Call>(await get(`/app/calls/${id(callId)}`), 'call')
      // A call still in progress may not have a transcript yet.
      return Array.isArray(call.transcript) ? call : { ...call, transcript: [] }
    },

    // ── Code ───────────────────────────────────────────────────────────────
    listAllowedRepos: async () => list<string>(await get('/app/repos'), 'repos'),
    listTasks: async () => list<Task>(await get('/app/tasks'), 'tasks'),
    getTask: async (taskId) => row<Task>(await get(`/app/tasks/${id(taskId)}`), 'task'),
    listTaskEvents: async (taskId) => list<TaskEvent>(await get(`/app/tasks/${id(taskId)}/events`), 'events'),
    createTask: async (input) =>
      row<Task>(await post('/app/tasks', { repo: input.repo.trim(), instructions: input.instructions.trim() }), 'task'),
    cancelTask: async (taskId) => row<Task>(await post(`/app/tasks/${id(taskId)}/cancel`), 'task'),

    // ── Memory ─────────────────────────────────────────────────────────────
    listHandbookEntries: async () => list<HandbookEntry>(await get('/app/handbook'), 'entries'),
    async saveHandbookEntry(input) {
      // notion_page_id is never sent: it belongs to the Notion sync.
      const values = {
        title: required(input.title, 'Give the entry a title.'),
        category: input.category.trim(),
        content: input.content.trim(),
        tags: cleanTags(input.tags),
      }
      const body =
        input.id === undefined ? await post('/app/handbook', values) : await put(`/app/handbook/${id(input.id)}`, values)
      return row<HandbookEntry>(body, 'entry')
    },
    async deleteHandbookEntry(entryId) {
      await client.request('DELETE', `/app/handbook/${id(entryId)}`)
    },
    listDecisions: async () => list<Decision>(await get('/app/decisions'), 'decisions'),
    async saveDecision(input) {
      const decidedOn = input.decided_on.trim()
      if (!CALENDAR_DATE.test(decidedOn)) throw new ServiceError('invalid', 'Pick the date this was decided.')
      const values = {
        title: required(input.title, 'Give the decision a title.'),
        decision: required(input.decision, 'Write down what was decided.'),
        rationale: input.rationale?.trim() || null,
        decided_on: decidedOn,
        tags: cleanTags(input.tags),
      }
      const body =
        input.id === undefined
          ? await post('/app/decisions', values)
          : await put(`/app/decisions/${id(input.id)}`, values)
      return row<Decision>(body, 'decision')
    },
    async deleteDecision(decisionId) {
      await client.request('DELETE', `/app/decisions/${id(decisionId)}`)
    },

    // ── Settings ───────────────────────────────────────────────────────────
    getSettings: async () => row<Settings>(await get('/app/settings'), 'settings'),
    async updateSettings(patch) {
      const values = editable(patch)
      if (Object.keys(values).length === 0) return row<Settings>(await get('/app/settings'), 'settings')
      return row<Settings>(await client.request('PATCH', '/app/settings', { body: values }), 'settings')
    },
    getConnections: () => connections(client),

    // ── Voice ──────────────────────────────────────────────────────────────
    async getVoiceSession() {
      const body = await post('/app/voice/session')
      const signedUrl = isRecord(body) ? body.signed_url : undefined
      if (typeof signedUrl !== 'string' || signedUrl === '') throw unreadable(body)
      return { signed_url: signedUrl }
    },
  }
}
