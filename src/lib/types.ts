/**
 * Domain types for Jarvis.
 *
 * These mirror the Postgres tables one-to-one (snake_case columns), so the
 * live service can return rows as-is and the demo service can build the same
 * shapes from sample data. If you change a field here, change the migration
 * in supabase/migrations and the webhook validators too.
 */

/** ISO-8601 timestamp with timezone, e.g. "2026-11-19T15:04:05.000Z". */
export type Timestamp = string

// ── Receptionist ───────────────────────────────────────────────────────────

export type ShopStatus = 'active' | 'paused'

export interface Shop {
  id: string
  name: string
  /** The public number Jarvis answers for this shop, E.164 (+15125550142). */
  phone: string
  address: string
  /** IANA timezone, e.g. "America/Chicago". */
  timezone: string
  status: ShopStatus
  created_at: Timestamp
}

/** A shop plus today's counters, as shown in the Receptionist list. */
export interface ShopSummary extends Shop {
  /** All calls that came in today, whatever the outcome. */
  calls_today: number
  /** Calls today that ended in a booking. */
  bookings_today: number
  /** Calls today that were missed or failed. */
  missed_today: number
  next_appointment_at: Timestamp | null
}

export type AppointmentStatus =
  | 'booked'
  | 'confirmed'
  | 'completed'
  | 'cancelled'
  | 'no_show'

export type AppointmentSource = 'jarvis' | 'online' | 'walk_in'

export interface Appointment {
  id: string
  shop_id: string
  /** The booking system's own id, used by the webhook to update in place. */
  external_id: string | null
  /** The call that produced this booking, when Jarvis booked it by phone. */
  call_id: string | null
  customer_name: string
  customer_phone: string | null
  service: string
  barber: string | null
  starts_at: Timestamp
  duration_minutes: number
  status: AppointmentStatus
  source: AppointmentSource
  notes: string | null
  created_at: Timestamp
}

/**
 * How a call ended.
 * - booked: Jarvis answered and booked an appointment
 * - answered: Jarvis answered and handled it (hours, prices, reschedule)
 * - message: Jarvis took a message for the shop
 * - transferred: Jarvis handed the caller to a person
 * - missed: nobody picked up (line down, caller hung up before the greeting)
 * - failed: the call started but broke (agent error, dropped audio)
 */
export type CallOutcome =
  | 'booked'
  | 'answered'
  | 'message'
  | 'transferred'
  | 'missed'
  | 'failed'

/** Outcomes that count as a problem: the "missed or failed" filter. */
export const PROBLEM_OUTCOMES: readonly CallOutcome[] = ['missed', 'failed']

export interface TranscriptTurn {
  role: 'agent' | 'caller'
  text: string
  /** Seconds from the start of the call. */
  t: number
}

/** A call as shown in lists: everything except the transcript. */
export interface CallSummary {
  id: string
  shop_id: string
  /** Provider id (Twilio CallSid or ElevenLabs conversation id). */
  external_id: string | null
  caller_name: string | null
  caller_phone: string
  started_at: Timestamp
  duration_seconds: number
  outcome: CallOutcome
  summary: string | null
  created_at: Timestamp
}

export interface Call extends CallSummary {
  transcript: TranscriptTurn[]
}

export type CallFilter = 'all' | 'problems'

// ── Code ───────────────────────────────────────────────────────────────────

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'needs_approval'
  | 'done'
  | 'failed'
  | 'cancelled'

/** Statuses where the task is still in flight and can be cancelled. */
export const ACTIVE_TASK_STATUSES: readonly TaskStatus[] = [
  'queued',
  'running',
  'needs_approval',
]

export interface Task {
  id: string
  /** The Jarvis backend's own id for this task, once it has picked it up. */
  external_id: string | null
  /** Short label derived from the instructions. */
  title: string
  /** "owner/name" — always one of settings.allowed_repos. */
  repo: string
  instructions: string
  status: TaskStatus
  branch: string | null
  result_summary: string | null
  pr_url: string | null
  error: string | null
  created_at: Timestamp
  updated_at: Timestamp
  started_at: Timestamp | null
  finished_at: Timestamp | null
}

/**
 * One line in a task's progress log.
 * - status: the task changed state ("Started", "Waiting for approval")
 * - log: a progress note from the agent
 * - command: a shell command the agent ran
 * - error: something went wrong
 */
export type TaskEventKind = 'status' | 'log' | 'command' | 'error'

export interface TaskEvent {
  id: string
  task_id: string
  kind: TaskEventKind
  message: string
  created_at: Timestamp
}

export interface NewTaskInput {
  repo: string
  instructions: string
}

// ── Approvals & alerts ─────────────────────────────────────────────────────

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired'
export type ApprovalDecision = 'approved' | 'denied'
export type ApprovalKind = 'code' | 'receptionist' | 'spend' | 'other'

export interface Approval {
  id: string
  kind: ApprovalKind
  /** The question, phrased so "Approve" is a clear answer. */
  title: string
  detail: string | null
  task_id: string | null
  shop_id: string | null
  status: ApprovalStatus
  requested_at: Timestamp
  decided_at: Timestamp | null
  expires_at: Timestamp | null
  created_at: Timestamp
}

export type AlertType =
  | 'missed_call'
  | 'failed_call'
  | 'approval_needed'
  | 'task_done'
  | 'task_failed'
  | 'system'

export const ALERT_TYPES: readonly AlertType[] = [
  'missed_call',
  'failed_call',
  'approval_needed',
  'task_done',
  'task_failed',
  'system',
]

/** How Jarvis reaches you about an alert. */
export type NotifyChannel = 'call' | 'text' | 'in_app'

export const NOTIFY_CHANNELS: readonly NotifyChannel[] = ['call', 'text', 'in_app']

export interface Alert {
  id: string
  type: AlertType
  title: string
  body: string | null
  shop_id: string | null
  call_id: string | null
  task_id: string | null
  approval_id: string | null
  /** The channel this alert was routed to, after quiet hours were applied. */
  channel: NotifyChannel
  read_at: Timestamp | null
  created_at: Timestamp
}

// ── Memory ─────────────────────────────────────────────────────────────────

export interface HandbookEntry {
  id: string
  title: string
  /** Free-form grouping, e.g. "Pricing", "Phone scripts", "Policies". */
  category: string
  /** Plain text. Line breaks are preserved. */
  content: string
  tags: string[]
  /** Set once the entry is synced with Notion. */
  notion_page_id: string | null
  created_at: Timestamp
  updated_at: Timestamp
}

export interface HandbookEntryInput {
  /** Omit to create a new entry. */
  id?: string
  title: string
  category: string
  content: string
  tags: string[]
}

export interface Decision {
  id: string
  title: string
  /** What was decided. */
  decision: string
  /** Why. */
  rationale: string | null
  /** Calendar date, "YYYY-MM-DD". */
  decided_on: string
  tags: string[]
  /** Set once the entry is synced with Notion. */
  notion_page_id: string | null
  created_at: Timestamp
  updated_at: Timestamp
}

export interface DecisionInput {
  /** Omit to create a new decision. */
  id?: string
  title: string
  decision: string
  rationale: string | null
  decided_on: string
  tags: string[]
}

// ── Settings ───────────────────────────────────────────────────────────────

export type NotificationPrefs = Record<AlertType, NotifyChannel>

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  missed_call: 'text',
  failed_call: 'text',
  approval_needed: 'text',
  task_done: 'in_app',
  task_failed: 'text',
  system: 'in_app',
}

export interface Settings {
  id: string
  /** The one account allowed to read anything. Null until the owner exists. */
  owner_id: string | null
  /** Where Jarvis calls or texts you, E.164. */
  notify_phone: string | null
  notification_prefs: NotificationPrefs
  quiet_hours_enabled: boolean
  /** "HH:MM" 24-hour, in `timezone`. */
  quiet_hours_start: string
  /** "HH:MM" 24-hour, in `timezone`. May be earlier than start (overnight). */
  quiet_hours_end: string
  /** IANA timezone used for quiet hours. */
  timezone: string
  /** Repos Jarvis may run coding tasks in, "owner/name". */
  allowed_repos: string[]
  updated_at: Timestamp
}

export type SettingsPatch = Partial<
  Pick<
    Settings,
    | 'notify_phone'
    | 'notification_prefs'
    | 'quiet_hours_enabled'
    | 'quiet_hours_start'
    | 'quiet_hours_end'
    | 'timezone'
    | 'allowed_repos'
  >
>

export type ServiceKey = 'elevenlabs' | 'twilio' | 'notion' | 'jarvis'

export const SERVICE_KEYS: readonly ServiceKey[] = [
  'elevenlabs',
  'twilio',
  'notion',
  'jarvis',
]

/**
 * - connected: we reached the service and it accepted our credentials
 * - not_configured: no credentials have been set yet
 * - error: credentials are set but the check failed
 */
export type ConnectionState = 'connected' | 'not_configured' | 'error'

export interface ConnectionStatus {
  service: ServiceKey
  state: ConnectionState
  /** One plain sentence: what we found, or what to do next. */
  detail: string
  latency_ms: number | null
  checked_at: Timestamp
}

// ── Home ───────────────────────────────────────────────────────────────────

export interface Brief {
  /** Local calendar date the numbers cover, "YYYY-MM-DD". */
  date: string
  calls_answered: number
  bookings_made: number
  missed_calls: number
  tasks_finished: number
}

export interface VoiceSession {
  /** Short-lived signed websocket URL for the ElevenLabs agent. */
  signed_url: string
}

// ── Realtime ───────────────────────────────────────────────────────────────

export type RealtimeTable =
  | 'tasks'
  | 'task_events'
  | 'approvals'
  | 'alerts'
  | 'calls'
  | 'appointments'

export const REALTIME_TABLES: readonly RealtimeTable[] = [
  'tasks',
  'task_events',
  'approvals',
  'alerts',
  'calls',
  'appointments',
]

export interface RowByTable {
  tasks: Task
  task_events: TaskEvent
  approvals: Approval
  alerts: Alert
  calls: CallSummary
  appointments: Appointment
}

export type ChangeType = 'INSERT' | 'UPDATE' | 'DELETE'

export type ChangeEvent = {
  [T in RealtimeTable]: {
    table: T
    type: ChangeType
    /** The row after the change. Null on DELETE. */
    row: RowByTable[T] | null
    /** Id of the affected row (always present, including on DELETE). */
    id: string
  }
}[RealtimeTable]

/**
 * - connecting: opening the live connection
 * - live: changes arrive as they happen
 * - offline: the connection dropped; data may be stale until it returns
 */
export type RealtimeStatus = 'connecting' | 'live' | 'offline'
