/**
 * Database rows → the exact shapes in src/lib/types.ts. Every field is set,
 * with null where a value is missing; internal columns are left behind.
 */
import type {
  Alert,
  Appointment,
  Approval,
  Call,
  CallSummary,
  Decision,
  HandbookEntry,
  NotificationPrefs,
  Settings,
  Shop,
  Task,
  TaskEvent,
  TranscriptTurn,
} from '../../src/lib/types.ts'

type Row = Record<string, unknown>

const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value))
const opt = (value: unknown): string | null => (value === null || value === undefined ? null : String(value))
const num = (value: unknown): number => Number(value ?? 0)

function jsonList<T>(value: unknown): T[] {
  try {
    const parsed = JSON.parse(str(value) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function toShop(row: Row): Shop {
  return {
    id: str(row.id),
    name: str(row.name),
    phone: str(row.phone),
    address: str(row.address),
    timezone: str(row.timezone),
    status: str(row.status) as Shop['status'],
    created_at: str(row.created_at),
  }
}

export function toCallSummary(row: Row): CallSummary {
  return {
    id: str(row.id),
    shop_id: str(row.shop_id),
    external_id: opt(row.external_id),
    caller_name: opt(row.caller_name),
    caller_phone: str(row.caller_phone),
    started_at: str(row.started_at),
    duration_seconds: num(row.duration_seconds),
    outcome: str(row.outcome) as CallSummary['outcome'],
    summary: opt(row.summary),
    created_at: str(row.created_at),
  }
}

export function toCall(row: Row): Call {
  return { ...toCallSummary(row), transcript: jsonList<TranscriptTurn>(row.transcript) }
}

export function toAppointment(row: Row): Appointment {
  return {
    id: str(row.id),
    shop_id: str(row.shop_id),
    external_id: opt(row.external_id),
    call_id: opt(row.call_id),
    customer_name: str(row.customer_name),
    customer_phone: opt(row.customer_phone),
    service: str(row.service),
    barber: opt(row.barber),
    starts_at: str(row.starts_at),
    duration_minutes: num(row.duration_minutes),
    status: str(row.status) as Appointment['status'],
    source: str(row.source) as Appointment['source'],
    notes: opt(row.notes),
    created_at: str(row.created_at),
  }
}

export function toTask(row: Row): Task {
  return {
    id: str(row.id),
    external_id: opt(row.external_id),
    title: str(row.title),
    repo: str(row.repo),
    instructions: str(row.instructions),
    status: str(row.status) as Task['status'],
    branch: opt(row.branch),
    result_summary: opt(row.result_summary),
    pr_url: opt(row.pr_url),
    error: opt(row.error),
    created_at: str(row.created_at),
    updated_at: str(row.updated_at),
    started_at: opt(row.started_at),
    finished_at: opt(row.finished_at),
  }
}

export function toTaskEvent(row: Row): TaskEvent {
  return {
    id: str(row.id),
    task_id: str(row.task_id),
    kind: str(row.kind) as TaskEvent['kind'],
    message: str(row.message),
    created_at: str(row.created_at),
  }
}

export function toApproval(row: Row): Approval {
  return {
    id: str(row.id),
    kind: str(row.kind) as Approval['kind'],
    title: str(row.title),
    detail: opt(row.detail),
    task_id: opt(row.task_id),
    shop_id: opt(row.shop_id),
    status: str(row.status) as Approval['status'],
    requested_at: str(row.requested_at),
    decided_at: opt(row.decided_at),
    expires_at: opt(row.expires_at),
    created_at: str(row.created_at),
  }
}

export function toAlert(row: Row): Alert {
  return {
    id: str(row.id),
    type: str(row.type) as Alert['type'],
    title: str(row.title),
    body: opt(row.body),
    shop_id: opt(row.shop_id),
    call_id: opt(row.call_id),
    task_id: opt(row.task_id),
    approval_id: opt(row.approval_id),
    channel: str(row.channel) as Alert['channel'],
    read_at: opt(row.read_at),
    created_at: str(row.created_at),
  }
}

export function toHandbookEntry(row: Row): HandbookEntry {
  return {
    id: str(row.id),
    title: str(row.title),
    category: str(row.category),
    content: str(row.content),
    tags: jsonList<string>(row.tags),
    notion_page_id: opt(row.notion_page_id),
    created_at: str(row.created_at),
    updated_at: str(row.updated_at),
  }
}

export function toDecision(row: Row): Decision {
  return {
    id: str(row.id),
    title: str(row.title),
    decision: str(row.decision),
    rationale: opt(row.rationale),
    decided_on: str(row.decided_on),
    tags: jsonList<string>(row.tags),
    notion_page_id: opt(row.notion_page_id),
    created_at: str(row.created_at),
    updated_at: str(row.updated_at),
  }
}

export function toSettings(row: Row): Settings {
  let prefs: NotificationPrefs
  try {
    prefs = JSON.parse(str(row.notification_prefs))
  } catch {
    prefs = {} as NotificationPrefs
  }
  return {
    id: str(row.id),
    owner_id: opt(row.owner_id),
    notify_phone: opt(row.notify_phone),
    notification_prefs: prefs,
    quiet_hours_enabled: Boolean(row.quiet_hours_enabled),
    quiet_hours_start: str(row.quiet_hours_start),
    quiet_hours_end: str(row.quiet_hours_end),
    timezone: str(row.timezone),
    allowed_repos: jsonList<string>(row.allowed_repos),
    updated_at: str(row.updated_at),
  }
}
