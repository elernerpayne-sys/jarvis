/**
 * Strict shape checks for webhook bodies, before anything reaches the
 * database. Mirrors the event table in docs/backend.md (and the limits the
 * database enforces again in jarvis_apply_events).
 *
 *   parseEnvelope(value)  { events: [...] } or a single { type, data }.
 *                         A malformed envelope is a 400 for the whole request.
 *   validateEvent(value)  one event. A problem becomes that event's error
 *                         sentence, naming the field.
 *
 * Rules: unknown fields are rejected; a reference is given by exactly one of
 * its two styles (shop_id or shop_phone, ...); timestamps are ISO-8601 with a
 * timezone; ids are uuids; phone numbers are E.164-like. An optional field
 * sent as null counts as absent, as it does in the database.
 */
import { isRecord, isUuid } from '../_shared/http.ts'

export const MAX_EVENTS = 100

export type EventType =
  | 'shop.upsert'
  | 'call.upsert'
  | 'appointment.upsert'
  | 'task.update'
  | 'task.event'
  | 'approval.request'
  | 'approval.expire'
  | 'alert.create'

export interface WebhookEvent {
  type: EventType
  data: Record<string, unknown>
}

export type EnvelopeResult = { ok: true; events: unknown[] } | { ok: false; message: string }

export type EventCheck =
  | { ok: true; event: WebhookEvent }
  | { ok: false; type: string | null; error: string }

// ── Field kinds ─────────────────────────────────────────────────────────────

type Field =
  | { kind: 'text'; max: number; required?: boolean }
  | { kind: 'choice'; values: readonly string[]; required?: boolean }
  | { kind: 'int'; min: number; max: number }
  | { kind: 'time'; required?: boolean }
  | { kind: 'uuid'; required?: boolean }
  | { kind: 'e164'; required?: boolean }
  | { kind: 'phone'; required?: boolean }
  | { kind: 'transcript' }

type RefKind = 'shop' | 'task' | 'call'

interface Schema {
  fields: Record<string, Field>
  refs: { kind: RefKind; required: boolean }[]
  /** At least one of these must be present (task.update). */
  needsOneOf?: readonly string[]
}

const REF_KEYS: Record<RefKind, [string, string]> = {
  shop: ['shop_id', 'shop_phone'],
  task: ['task_id', 'task_external_id'],
  call: ['call_id', 'call_external_id'],
}

const OUTCOMES = ['booked', 'answered', 'message', 'transferred', 'missed', 'failed'] as const
const TASK_STATUSES = ['queued', 'running', 'needs_approval', 'done', 'failed', 'cancelled'] as const
const APPOINTMENT_STATUSES = ['booked', 'confirmed', 'completed', 'cancelled', 'no_show'] as const
const SOURCES = ['jarvis', 'online', 'walk_in'] as const
const TASK_CHANGES = ['status', 'external_id', 'title', 'branch', 'result_summary', 'pr_url', 'error'] as const

const SCHEMAS: Record<EventType, Schema> = {
  'shop.upsert': {
    fields: {
      name: { kind: 'text', max: 200, required: true },
      phone: { kind: 'e164', required: true },
      address: { kind: 'text', max: 500 },
      timezone: { kind: 'text', max: 64 },
      status: { kind: 'choice', values: ['active', 'paused'] },
    },
    refs: [],
  },
  'call.upsert': {
    fields: {
      external_id: { kind: 'text', max: 200, required: true },
      caller_phone: { kind: 'phone', required: true },
      caller_name: { kind: 'text', max: 200 },
      started_at: { kind: 'time', required: true },
      duration_seconds: { kind: 'int', min: 0, max: 86400 },
      outcome: { kind: 'choice', values: OUTCOMES, required: true },
      summary: { kind: 'text', max: 10000 },
      transcript: { kind: 'transcript' },
    },
    refs: [{ kind: 'shop', required: true }],
  },
  'appointment.upsert': {
    fields: {
      external_id: { kind: 'text', max: 200, required: true },
      customer_name: { kind: 'text', max: 200, required: true },
      customer_phone: { kind: 'phone' },
      service: { kind: 'text', max: 200, required: true },
      barber: { kind: 'text', max: 200 },
      starts_at: { kind: 'time', required: true },
      duration_minutes: { kind: 'int', min: 1, max: 1440 },
      status: { kind: 'choice', values: APPOINTMENT_STATUSES },
      source: { kind: 'choice', values: SOURCES },
      notes: { kind: 'text', max: 10000 },
    },
    refs: [
      { kind: 'shop', required: true },
      { kind: 'call', required: false },
    ],
  },
  'task.update': {
    fields: {
      status: { kind: 'choice', values: TASK_STATUSES },
      external_id: { kind: 'text', max: 200 },
      title: { kind: 'text', max: 300 },
      branch: { kind: 'text', max: 255 },
      result_summary: { kind: 'text', max: 20000 },
      pr_url: { kind: 'text', max: 2000 },
      error: { kind: 'text', max: 10000 },
    },
    refs: [{ kind: 'task', required: true }],
    needsOneOf: TASK_CHANGES,
  },
  'task.event': {
    fields: {
      kind: { kind: 'choice', values: ['status', 'log', 'command', 'error'], required: true },
      message: { kind: 'text', max: 20000, required: true },
      created_at: { kind: 'time' },
    },
    refs: [{ kind: 'task', required: true }],
  },
  'approval.request': {
    fields: {
      kind: { kind: 'choice', values: ['code', 'receptionist', 'spend', 'other'], required: true },
      title: { kind: 'text', max: 300, required: true },
      detail: { kind: 'text', max: 10000 },
      expires_at: { kind: 'time' },
    },
    refs: [
      { kind: 'task', required: false },
      { kind: 'shop', required: false },
    ],
  },
  'approval.expire': {
    fields: { id: { kind: 'uuid', required: true } },
    refs: [],
  },
  'alert.create': {
    fields: {
      type: {
        kind: 'choice',
        values: ['missed_call', 'failed_call', 'approval_needed', 'task_done', 'task_failed', 'system'],
        required: true,
      },
      title: { kind: 'text', max: 300, required: true },
      body: { kind: 'text', max: 10000 },
      approval_id: { kind: 'uuid' },
    },
    refs: [
      { kind: 'shop', required: false },
      { kind: 'call', required: false },
      { kind: 'task', required: false },
    ],
  },
}

export const EVENT_TYPES = Object.keys(SCHEMAS) as EventType[]

const E164 = /^\+[1-9][0-9]{6,14}$/
/** E.164-like: an optional +, then 3 to 15 digits. Short codes and numbers without a + pass. */
const PHONE_ISH = /^\+?[0-9]{3,15}$/
const ISO_TIME = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?([Zz]|[+-]\d{2}(:?\d{2})?)$/

// ── Envelope ────────────────────────────────────────────────────────────────

export function parseEnvelope(value: unknown): EnvelopeResult {
  if (!isRecord(value)) {
    return { ok: false, message: 'Send { "events": [ ... ] } or a single { "type", "data" } object.' }
  }
  if ('events' in value) {
    const extra = Object.keys(value).find((key) => key !== 'events')
    if (extra) return { ok: false, message: `Unknown field "${short(extra)}" next to "events".` }
    if (!Array.isArray(value.events)) return { ok: false, message: '"events" must be a list.' }
    if (value.events.length === 0) return { ok: false, message: '"events" is empty. Send at least one event.' }
    if (value.events.length > MAX_EVENTS) {
      return {
        ok: false,
        message: `That is ${value.events.length} events. Send at most ${MAX_EVENTS} per request.`,
      }
    }
    return { ok: true, events: value.events }
  }
  if ('type' in value) return { ok: true, events: [value] }
  return { ok: false, message: 'Send { "events": [ ... ] } or a single { "type", "data" } object.' }
}

// ── One event ───────────────────────────────────────────────────────────────

export function validateEvent(value: unknown): EventCheck {
  if (!isRecord(value)) {
    return { ok: false, type: null, error: 'Each event must be an object: { "type": "…", "data": { … } }.' }
  }
  const type = typeof value.type === 'string' ? value.type : null
  const fail = (error: string): EventCheck => ({ ok: false, type: type === null ? null : short(type), error })

  if (type === null) return fail('This event has no "type".')
  const extra = Object.keys(value).find((key) => key !== 'type' && key !== 'data')
  if (extra) return fail(`Unknown field "${short(extra)}" on the event. Put it inside "data".`)
  if (!(type in SCHEMAS)) {
    return fail(`Unknown event type "${short(type)}". Use one of: ${EVENT_TYPES.join(', ')}.`)
  }
  const eventType = type as EventType
  if (!isRecord(value.data)) return fail('"data" must be an object.')
  const data = value.data
  const schema = SCHEMAS[eventType]

  const allowed = new Set<string>(Object.keys(schema.fields))
  for (const ref of schema.refs) for (const key of REF_KEYS[ref.kind]) allowed.add(key)
  const unknown = Object.keys(data).filter((key) => !allowed.has(key)).sort()[0]
  if (unknown !== undefined) {
    return fail(
      `Unknown field "${short(unknown)}" in ${eventType}. Allowed fields: ${[...allowed].join(', ')}.`,
    )
  }

  for (const ref of schema.refs) {
    const problem = checkRef(data, ref.kind, ref.required)
    if (problem) return fail(problem)
  }
  for (const [key, field] of Object.entries(schema.fields)) {
    const problem = checkField(key, field, data[key])
    if (problem) return fail(problem)
  }
  if (schema.needsOneOf && !schema.needsOneOf.some((key) => present(data[key]))) {
    return fail(`${eventType} needs at least one field to change: ${schema.needsOneOf.join(', ')}.`)
  }
  return { ok: true, event: { type: eventType, data } }
}

function present(value: unknown): boolean {
  return value !== undefined && value !== null
}

function checkRef(data: Record<string, unknown>, kind: RefKind, required: boolean): string | null {
  const [idKey, ownKey] = REF_KEYS[kind]
  const hasId = present(data[idKey])
  const hasOwn = present(data[ownKey])
  if (hasId && hasOwn) return `Send only one of "${idKey}" or "${ownKey}", not both.`
  if (!hasId && !hasOwn) {
    return required ? `Say which ${kind} this is for: send "${idKey}" or "${ownKey}".` : null
  }
  if (hasId) return isUuid(data[idKey]) ? null : `"${idKey}" is not a valid id.`
  if (kind === 'shop') {
    return typeof data[ownKey] === 'string' && E164.test(data[ownKey] as string)
      ? null
      : `"${ownKey}" must be the full number with country code and digits only, like +15125550142.`
  }
  return checkField(ownKey, { kind: 'text', max: 200, required: true }, data[ownKey])
}

function checkField(key: string, field: Field, value: unknown): string | null {
  const required = 'required' in field && field.required === true
  if (!present(value)) return required ? `"${key}" is required.` : null

  switch (field.kind) {
    case 'text': {
      if (typeof value !== 'string') return `"${key}" must be text.`
      const trimmed = value.trim()
      if (trimmed === '') return required ? `"${key}" cannot be empty.` : null
      const length = [...trimmed].length
      if (length > field.max) {
        return `"${key}" is too long: ${length} characters, and the limit is ${field.max}.`
      }
      return null
    }
    case 'choice': {
      if (typeof value !== 'string') return `"${key}" must be text.`
      return field.values.includes(value)
        ? null
        : `"${short(value)}" is not a valid ${key}. Use one of: ${field.values.join(', ')}.`
    }
    case 'int': {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < field.min || value > field.max) {
        return `"${key}" must be a whole number from ${field.min} to ${field.max}.`
      }
      return null
    }
    case 'time': {
      if (typeof value !== 'string' || !ISO_TIME.test(value) || Number.isNaN(Date.parse(value.replace(' ', 'T')))) {
        return `"${key}" must be an ISO-8601 time with its timezone, like 2026-11-19T15:04:05Z.`
      }
      return null
    }
    case 'uuid':
      return isUuid(value) ? null : `"${key}" is not a valid id.`
    case 'e164':
      return typeof value === 'string' && E164.test(value)
        ? null
        : `"${key}" must be the full number with country code and digits only, like +15125550142.`
    case 'phone':
      return typeof value === 'string' && PHONE_ISH.test(value)
        ? null
        : `"${key}" must be a phone number in digits, ideally with country code, like +15125550142.`
    case 'transcript':
      return checkTranscript(value)
  }
}

function checkTranscript(value: unknown): string | null {
  if (!Array.isArray(value)) return '"transcript" must be a list of turns.'
  for (let i = 0; i < value.length; i++) {
    const turn = value[i]
    const ok = isRecord(turn) &&
      (turn.role === 'agent' || turn.role === 'caller') &&
      typeof turn.text === 'string' &&
      typeof turn.t === 'number' && Number.isFinite(turn.t) && turn.t >= 0 &&
      Object.keys(turn).every((key) => key === 'role' || key === 'text' || key === 't')
    if (!ok) {
      return `Turn ${i + 1} of "transcript" is not valid. Each turn is { "role": "agent" or "caller", "text": "...", "t": seconds from the start }.`
    }
  }
  return null
}

/** Echo a sender's value back safely: no control characters, at most 60 characters. */
function short(value: string): string {
  // deno-lint-ignore no-control-regex
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, '?')
  return clean.length > 60 ? `${clean.slice(0, 57)}...` : clean
}
