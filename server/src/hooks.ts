/**
 * POST /hooks/events: any service (your task runner, a booking system, a
 * script) pushes calls, appointments, task progress, approval requests and
 * alerts into Jarvis. Same signing, event types and results as the Supabase
 * webhook in docs/backend.md:
 *
 *   X-Jarvis-Signature: t=<unix seconds>,v1=<hex hmac_sha256(JARVIS_WEBHOOK_SECRET, "<t>.<raw body>")>
 *   { "events": [ { "type": "call.upsert", "data": { … } }, … ] }   (or one { type, data })
 *   → 200 { "results": [ { "index", "type", "ok": true, "id", "notify"? } ] }, 422 when any failed
 *
 * Ids here are the ids Jarvis gave out (any string), not necessarily UUIDs.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { AlertType } from '../../src/lib/types.ts'
import type { Config } from './config.ts'
import { ApiError } from './errors.ts'
import { readBody, sendJson, TooLarge } from './http.ts'
import type { Notify } from './routing.ts'
import { ReplayGuard, verify } from './signature.ts'
import type { Store, Tx } from './store.ts'
import { isRecord, logError, parseJson, toIso } from './util.ts'

export const HOOK_BODY_LIMIT = 1024 * 1024
export const TOLERANCE_SECONDS = 5 * 60
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

type Field =
  | { kind: 'text'; max: number; required?: boolean }
  | { kind: 'choice'; values: readonly string[]; required?: boolean }
  | { kind: 'int'; min: number; max: number }
  | { kind: 'time'; required?: boolean }
  | { kind: 'id'; required?: boolean }
  | { kind: 'e164'; required?: boolean }
  | { kind: 'phone'; required?: boolean }
  | { kind: 'transcript' }

type RefKind = 'shop' | 'task' | 'call'

interface Schema {
  fields: Record<string, Field>
  refs: { kind: RefKind; required: boolean }[]
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
const ALERT_TYPES = ['missed_call', 'failed_call', 'approval_needed', 'task_done', 'task_failed', 'system'] as const

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
    fields: { id: { kind: 'id', required: true } },
    refs: [],
  },
  'alert.create': {
    fields: {
      type: { kind: 'choice', values: ALERT_TYPES, required: true },
      title: { kind: 'text', max: 300, required: true },
      body: { kind: 'text', max: 10000 },
      approval_id: { kind: 'id' },
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
const PHONE_ISH = /^\+?[0-9]{3,15}$/
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/

/** Echo a sender's value back safely: no control characters, at most 60 characters. */
function short(value: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, '?')
  return clean.length > 60 ? `${clean.slice(0, 57)}...` : clean
}

const present = (value: unknown) => value !== undefined && value !== null

export function parseEnvelope(value: unknown): { ok: true; events: unknown[] } | { ok: false; message: string } {
  const shape = 'Send { "events": [ ... ] } or a single { "type", "data" } object.'
  if (!isRecord(value)) return { ok: false, message: shape }
  if ('events' in value) {
    const extra = Object.keys(value).find((key) => key !== 'events')
    if (extra) return { ok: false, message: `Unknown field "${short(extra)}" next to "events".` }
    if (!Array.isArray(value.events)) return { ok: false, message: '"events" must be a list.' }
    if (value.events.length === 0) return { ok: false, message: '"events" is empty. Send at least one event.' }
    if (value.events.length > MAX_EVENTS) {
      return { ok: false, message: `That is ${value.events.length} events. Send at most ${MAX_EVENTS} per request.` }
    }
    return { ok: true, events: value.events }
  }
  if ('type' in value) return { ok: true, events: [value] }
  return { ok: false, message: shape }
}

type Checked = { ok: true; type: EventType; data: Record<string, unknown> } | { ok: false; type: string | null; error: string }

export function validateEvent(value: unknown): Checked {
  if (!isRecord(value)) return { ok: false, type: null, error: 'Each event must be an object: { "type": "…", "data": { … } }.' }
  const type = typeof value.type === 'string' ? value.type : null
  const fail = (error: string): Checked => ({ ok: false, type: type === null ? null : short(type), error })
  if (type === null) return fail('This event has no "type".')
  const extra = Object.keys(value).find((key) => key !== 'type' && key !== 'data')
  if (extra) return fail(`Unknown field "${short(extra)}" on the event. Put it inside "data".`)
  if (!(type in SCHEMAS)) return fail(`Unknown event type "${short(type)}". Use one of: ${EVENT_TYPES.join(', ')}.`)
  const eventType = type as EventType
  if (!isRecord(value.data)) return fail('"data" must be an object.')
  const data = value.data
  const schema = SCHEMAS[eventType]

  const allowed = new Set<string>(Object.keys(schema.fields))
  for (const ref of schema.refs) for (const key of REF_KEYS[ref.kind]) allowed.add(key)
  const unknown = Object.keys(data).filter((key) => !allowed.has(key)).sort()[0]
  if (unknown !== undefined) return fail(`Unknown field "${short(unknown)}" in ${eventType}. Allowed fields: ${[...allowed].join(', ')}.`)

  for (const ref of schema.refs) {
    const [idKey, ownKey] = REF_KEYS[ref.kind]
    const hasId = present(data[idKey])
    const hasOwn = present(data[ownKey])
    if (hasId && hasOwn) return fail(`Send only one of "${idKey}" or "${ownKey}", not both.`)
    if (!hasId && !hasOwn) {
      if (ref.required) return fail(`Say which ${ref.kind} this is for: send "${idKey}" or "${ownKey}".`)
      continue
    }
    if (hasId) {
      if (typeof data[idKey] !== 'string' || !ID.test(data[idKey] as string)) return fail(`"${idKey}" is not a valid id.`)
    } else if (ref.kind === 'shop') {
      if (typeof data[ownKey] !== 'string' || !E164.test(data[ownKey] as string)) {
        return fail(`"${ownKey}" must be the full number with country code and digits only, like +15125550142.`)
      }
    } else {
      const problem = checkField(ownKey, { kind: 'text', max: 200, required: true }, data[ownKey])
      if (problem) return fail(problem)
    }
  }
  for (const [key, field] of Object.entries(schema.fields)) {
    const problem = checkField(key, field, data[key])
    if (problem) return fail(problem)
  }
  if (schema.needsOneOf && !schema.needsOneOf.some((key) => present(data[key]))) {
    return fail(`${eventType} needs at least one field to change: ${schema.needsOneOf.join(', ')}.`)
  }
  return { ok: true, type: eventType, data }
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
      return length > field.max ? `"${key}" is too long: ${length} characters, and the limit is ${field.max}.` : null
    }
    case 'choice':
      if (typeof value !== 'string') return `"${key}" must be text.`
      return field.values.includes(value) ? null : `"${short(value)}" is not a valid ${key}. Use one of: ${field.values.join(', ')}.`
    case 'int':
      return typeof value === 'number' && Number.isInteger(value) && value >= field.min && value <= field.max
        ? null
        : `"${key}" must be a whole number from ${field.min} to ${field.max}.`
    case 'time':
      return toIso(value) ? null : `"${key}" must be an ISO-8601 time with its timezone, like 2026-11-19T15:04:05Z.`
    case 'id':
      return typeof value === 'string' && ID.test(value) ? null : `"${key}" is not a valid id.`
    case 'e164':
      return typeof value === 'string' && E164.test(value) ? null : `"${key}" must be the full number with country code and digits only, like +15125550142.`
    case 'phone':
      return typeof value === 'string' && PHONE_ISH.test(value) ? null : `"${key}" must be a phone number in digits, ideally with country code, like +15125550142.`
    case 'transcript': {
      if (!Array.isArray(value)) return '"transcript" must be a list of turns.'
      for (let i = 0; i < value.length; i++) {
        const turn = value[i]
        const ok =
          isRecord(turn) &&
          (turn.role === 'agent' || turn.role === 'caller') &&
          typeof turn.text === 'string' &&
          typeof turn.t === 'number' &&
          Number.isFinite(turn.t) &&
          turn.t >= 0 &&
          Object.keys(turn).every((k) => k === 'role' || k === 'text' || k === 't')
        if (!ok) return `Turn ${i + 1} of "transcript" is not valid. Each turn is { "role": "agent" or "caller", "text": "...", "t": seconds from the start }.`
      }
      return null
    }
  }
}

// ── Applying events ────────────────────────────────────────────────────────

class EventError extends Error {}

/** Optional text: trimmed, or null when sent as null/blank, or undefined when not sent. */
function optText(data: Record<string, unknown>, key: string): string | null | undefined {
  if (!(key in data)) return undefined
  const value = data[key]
  if (value === null || value === undefined) return null
  const trimmed = String(value).trim()
  return trimmed === '' ? null : trimmed
}
const reqText = (data: Record<string, unknown>, key: string) => String(data[key]).trim()
const optTime = (data: Record<string, unknown>, key: string) => (present(data[key]) ? (toIso(data[key]) as string) : undefined)

function resolve(store: Store, kind: RefKind, data: Record<string, unknown>, required: boolean): string | null {
  const [idKey, ownKey] = REF_KEYS[kind]
  const db = store.db
  const table = kind === 'shop' ? 'shops' : kind === 'task' ? 'tasks' : 'calls'
  if (present(data[idKey])) {
    const row = db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(String(data[idKey]))
    if (!row) throw new EventError(`No ${kind} with that id.`)
    return String(row.id)
  }
  if (present(data[ownKey])) {
    const column = kind === 'shop' ? 'phone' : 'external_id'
    const row = db.prepare(`SELECT id FROM ${table} WHERE ${column} = ?`).get(String(data[ownKey]).trim())
    if (!row) {
      throw new EventError(kind === 'shop' ? 'No shop with that phone number. Send shop.upsert first.' : `No ${kind} with that external id.`)
    }
    return String(row.id)
  }
  if (required) throw new EventError(`Say which ${kind} this is for: send "${idKey}" or "${ownKey}".`)
  return null
}

function apply(store: Store, tx: Tx, type: EventType, data: Record<string, unknown>): { id: string; notify?: Notify } {
  switch (type) {
    case 'shop.upsert':
      return {
        id: store.upsertShop({
          name: reqText(data, 'name'),
          phone: reqText(data, 'phone'),
          address: optText(data, 'address') ?? undefined,
          timezone: optText(data, 'timezone') ?? undefined,
          status: optText(data, 'status') ?? undefined,
        }),
      }
    case 'call.upsert':
      return {
        id: store.upsertCall(tx, {
          external_id: reqText(data, 'external_id'),
          shop_id: resolve(store, 'shop', data, true) as string,
          caller_phone: reqText(data, 'caller_phone'),
          caller_name: optText(data, 'caller_name'),
          started_at: toIso(data.started_at) as string,
          duration_seconds: present(data.duration_seconds) ? Number(data.duration_seconds) : undefined,
          outcome: reqText(data, 'outcome'),
          summary: optText(data, 'summary'),
          transcript: present(data.transcript) ? (data.transcript as unknown[]) : undefined,
        }),
      }
    case 'appointment.upsert': {
      const callGiven = present(data.call_id) || present(data.call_external_id)
      return {
        id: store.upsertAppointment(tx, {
          external_id: reqText(data, 'external_id'),
          shop_id: resolve(store, 'shop', data, true) as string,
          call_id: callGiven ? resolve(store, 'call', data, false) : undefined,
          customer_name: reqText(data, 'customer_name'),
          customer_phone: optText(data, 'customer_phone'),
          service: reqText(data, 'service'),
          barber: optText(data, 'barber'),
          starts_at: toIso(data.starts_at) as string,
          duration_minutes: present(data.duration_minutes) ? Number(data.duration_minutes) : undefined,
          status: optText(data, 'status') ?? undefined,
          source: optText(data, 'source') ?? undefined,
          notes: optText(data, 'notes'),
        }),
      }
    }
    case 'task.update': {
      const taskId = resolve(store, 'task', data, true) as string
      const task = store.getTask(taskId)
      if (!task) throw new EventError('No task with that id.')
      const externalId = optText(data, 'external_id')
      if (externalId) {
        const taken = store.db.prepare('SELECT id FROM tasks WHERE external_id = ? AND id <> ?').get(externalId, taskId)
        if (taken) throw new EventError('Another task already has that external_id.')
      }
      const extra: Record<string, string | null> = {}
      for (const key of ['external_id', 'branch', 'result_summary', 'pr_url', 'error'] as const) {
        const value = optText(data, key)
        if (value !== undefined) extra[key] = value
      }
      const title = optText(data, 'title')
      if (title) extra.title = title
      const status = (optText(data, 'status') ?? task.status) as typeof task.status
      store.setTaskStatus(tx, task, status, extra)
      return { id: taskId }
    }
    case 'task.event': {
      const taskId = resolve(store, 'task', data, true) as string
      return { id: store.addTaskEvent(tx, taskId, reqText(data, 'kind') as 'log', reqText(data, 'message'), optTime(data, 'created_at')) }
    }
    case 'approval.request':
      return {
        id: store.requestApproval(tx, {
          kind: reqText(data, 'kind'),
          title: reqText(data, 'title'),
          detail: optText(data, 'detail'),
          task_id: resolve(store, 'task', data, false),
          shop_id: resolve(store, 'shop', data, false),
          expires_at: optTime(data, 'expires_at') ?? null,
        }),
      }
    case 'approval.expire': {
      const id = reqText(data, 'id')
      const approval = store.getApproval(id)
      if (!approval) throw new EventError('No approval with that id.')
      if (approval.status === 'approved' || approval.status === 'denied') {
        throw new EventError(`That approval was already ${approval.status}, so it cannot expire.`)
      }
      if (approval.status === 'pending') {
        store.db.prepare("UPDATE approvals SET status = 'expired' WHERE id = ?").run(id)
        tx.changed('approvals', 'UPDATE', id)
      }
      return { id }
    }
    case 'alert.create': {
      const approvalId = optText(data, 'approval_id')
      if (approvalId && !store.getApproval(approvalId)) throw new EventError('No approval with that id.')
      const created = store.createAlert(tx, {
        type: reqText(data, 'type') as AlertType,
        title: reqText(data, 'title'),
        body: optText(data, 'body') ?? null,
        shop_id: resolve(store, 'shop', data, false),
        call_id: resolve(store, 'call', data, false),
        task_id: resolve(store, 'task', data, false),
        approval_id: approvalId ?? null,
      })
      return created
    }
  }
}

export interface EventResult {
  index: number
  type: string | null
  ok: boolean
  id?: string
  notify?: Notify
  error?: string
}

/** Applies events in order, each in its own transaction; a failing one never stops the rest. */
export function applyEvents(store: Store, events: unknown[]): EventResult[] {
  return events.map((raw, index): EventResult => {
    const checked = validateEvent(raw)
    if (!checked.ok) return { index, type: checked.type, ok: false, error: checked.error }
    try {
      const applied = store.write((tx) => apply(store, tx, checked.type, checked.data))
      return { index, type: checked.type, ok: true, ...applied }
    } catch (error) {
      if (error instanceof EventError) return { index, type: checked.type, ok: false, error: error.message }
      logError(`hooks: ${checked.type} failed`, error)
      return { index, type: checked.type, ok: false, error: 'Jarvis couldn’t store this event.' }
    }
  })
}

const guard = new ReplayGuard()

export async function handleEventsHook(req: IncomingMessage, res: ServerResponse, store: Store, config: Config): Promise<void> {
  if (!config.webhookSecret) {
    // Read nothing; say what's missing.
    req.resume()
    throw new ApiError(503, 'not_configured', 'Set JARVIS_WEBHOOK_SECRET on the Jarvis server to accept pushed events.')
  }
  let raw: Buffer
  try {
    raw = await readBody(req, HOOK_BODY_LIMIT)
  } catch (error) {
    if (error instanceof TooLarge) throw new ApiError(413, 'invalid', 'That request is over 1 MB.')
    throw error
  }
  const verdict = verify({
    secret: config.webhookSecret,
    header: req.headers['x-jarvis-signature'],
    body: raw,
    scheme: 'v1',
    toleranceSeconds: TOLERANCE_SECONDS,
    guard,
  })
  if (verdict === 'replay') throw new ApiError(409, 'invalid', 'This request was already received.')
  if (verdict !== 'ok') {
    const message =
      verdict === 'missing'
        ? 'Sign the request with an X-Jarvis-Signature header.'
        : verdict === 'stale'
          ? 'The signature is too old or from the future. Check the sender’s clock.'
          : 'The signature doesn’t match.'
    throw new ApiError(401, 'unauthorized', message)
  }
  const envelope = parseEnvelope(parseJson(raw.toString('utf8')))
  if (!envelope.ok) throw new ApiError(400, 'invalid', envelope.message)
  const results = applyEvents(store, envelope.events)
  sendJson(res, results.every((result) => result.ok) ? 200 : 422, { results })
}
