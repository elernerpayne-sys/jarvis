/**
 * The columns each query asks for, written out instead of `select *` so a
 * list never downloads more than its screen shows (call lists must not pull
 * transcripts) and a column added to the database later cannot change what
 * the app receives.
 */
import type {
  Alert,
  Appointment,
  Approval,
  Call,
  CallSummary,
  Decision,
  HandbookEntry,
  Settings,
  ShopSummary,
  Task,
  TaskEvent,
} from '@/lib/types'

/**
 * Builds the column list for row type T. It only compiles when every field
 * of T is named: leave one out and the call demands a second argument typed
 * as the missing field, so these lists cannot drift from src/lib/types.ts.
 */
function columns<T>() {
  return <const K extends readonly (keyof T & string)[]>(
    names: K,
    ..._missing: [Exclude<keyof T, K[number]>] extends [never] ? [] : [missing: Exclude<keyof T, K[number]>]
  ): string => names.join(',')
}

export const SHOP_SUMMARY_COLUMNS = columns<ShopSummary>()([
  'id',
  'name',
  'phone',
  'address',
  'timezone',
  'status',
  'created_at',
  'calls_today',
  'bookings_today',
  'missed_today',
  'next_appointment_at',
])

export const APPOINTMENT_COLUMNS = columns<Appointment>()([
  'id',
  'shop_id',
  'external_id',
  'call_id',
  'customer_name',
  'customer_phone',
  'service',
  'barber',
  'starts_at',
  'duration_minutes',
  'status',
  'source',
  'notes',
  'created_at',
])

const CALL_SUMMARY_FIELDS = [
  'id',
  'shop_id',
  'external_id',
  'caller_name',
  'caller_phone',
  'started_at',
  'duration_seconds',
  'outcome',
  'summary',
  'created_at',
] as const

/** Everything about a call except the transcript: what lists show. */
export const CALL_SUMMARY_COLUMNS = columns<CallSummary>()(CALL_SUMMARY_FIELDS)

/** A call with its transcript: only for the one call being read. */
export const CALL_COLUMNS = columns<Call>()([...CALL_SUMMARY_FIELDS, 'transcript'])

export const TASK_COLUMNS = columns<Task>()([
  'id',
  'external_id',
  'title',
  'repo',
  'instructions',
  'status',
  'branch',
  'result_summary',
  'pr_url',
  'error',
  'created_at',
  'updated_at',
  'started_at',
  'finished_at',
])

export const TASK_EVENT_COLUMNS = columns<TaskEvent>()(['id', 'task_id', 'kind', 'message', 'created_at'])

export const APPROVAL_COLUMNS = columns<Approval>()([
  'id',
  'kind',
  'title',
  'detail',
  'task_id',
  'shop_id',
  'status',
  'requested_at',
  'decided_at',
  'expires_at',
  'created_at',
])

export const ALERT_COLUMNS = columns<Alert>()([
  'id',
  'type',
  'title',
  'body',
  'shop_id',
  'call_id',
  'task_id',
  'approval_id',
  'channel',
  'read_at',
  'created_at',
])

export const HANDBOOK_COLUMNS = columns<HandbookEntry>()([
  'id',
  'title',
  'category',
  'content',
  'tags',
  'notion_page_id',
  'created_at',
  'updated_at',
])

export const DECISION_COLUMNS = columns<Decision>()([
  'id',
  'title',
  'decision',
  'rationale',
  'decided_on',
  'tags',
  'notion_page_id',
  'created_at',
  'updated_at',
])

export const SETTINGS_COLUMNS = columns<Settings>()([
  'id',
  'owner_id',
  'notify_phone',
  'notification_prefs',
  'quiet_hours_enabled',
  'quiet_hours_start',
  'quiet_hours_end',
  'timezone',
  'allowed_repos',
  'updated_at',
])
