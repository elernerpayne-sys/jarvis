import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { handleWebhook, MAX_BODY_BYTES, ReplayGuard } from '../jarvis-webhook/handler.ts'
import { sign } from '../jarvis-webhook/signature.ts'
import { validateEvent } from '../jarvis-webhook/validate.ts'
import type { DbResult } from '../_shared/db.ts'
import { bodyOf, captureLogs, envOf, fakeDb } from './helpers.ts'

const SECRET = 'whsec_test_secret'
const NOW = new Date('2026-11-19T12:00:00Z')
const T = Math.floor(NOW.getTime() / 1000)
const U1 = '55555555-5555-4555-8555-555555555555'
const U2 = '66666666-6666-4666-8666-666666666666'

/** Fake jarvis_apply_events: ok for each event, with a notify for alerts. */
function applyingDb(override?: (events: unknown[]) => DbResult<unknown>) {
  return fakeDb({
    jarvis_apply_events: (args) => {
      const events = args.p_events as { type: string }[]
      if (override) return override(events)
      return {
        ok: true,
        data: events.map((e, index) => ({
          index, type: e.type, ok: true, id: U1,
          ...(e.type === 'alert.create' ? { notify: { channel: 'text', phone: '+15125550100', quiet_hours: false } } : {}),
        })),
      }
    },
  })
}

async function deliver(
  payload: unknown,
  opts: { secret?: string; env?: Record<string, string>; t?: number; db?: ReturnType<typeof fakeDb>; raw?: string; method?: string; header?: string; replay?: ReplayGuard } = {},
) {
  const raw = opts.raw ?? JSON.stringify(payload)
  const bytes = new TextEncoder().encode(raw)
  const t = opts.t ?? T
  const header = opts.header ?? `t=${t},v1=${await sign(opts.secret ?? SECRET, t, bytes)}`
  const db = opts.db ?? applyingDb()
  const method = opts.method ?? 'POST'
  const request = new Request('https://project.supabase.co/functions/v1/jarvis-webhook', {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Jarvis-Signature': header },
    body: method === 'GET' ? undefined : raw,
  })
  const { result: res, logs } = await captureLogs(() =>
    handleWebhook(request, {
      env: envOf(opts.env ?? { JARVIS_WEBHOOK_SECRET: SECRET }),
      db: db.db,
      now: () => NOW,
      replay: opts.replay,
    })
  )
  return { res, body: await bodyOf(res), db, logs }
}

const SHOP = { type: 'shop.upsert', data: { name: 'Fade Lab', phone: '+15125550101', timezone: 'America/Chicago' } }
const CALL = {
  type: 'call.upsert',
  data: {
    external_id: 'call-1', shop_phone: '+15125550101', caller_phone: '+15125550150', started_at: '2026-11-19T15:04:05Z',
    outcome: 'booked', duration_seconds: 92, transcript: [{ role: 'agent', text: 'Hi', t: 0 }, { role: 'caller', text: 'Hey', t: 1.5 }],
  },
}

// ── Signature and transport ────────────────────────────────────────────────

Deno.test('webhook: valid signature applies and answers 200', async () => {
  const r = await deliver({ events: [SHOP, CALL] })
  assertEquals(r.res.status, 200)
  assertEquals(r.db.args.jarvis_apply_events[0].p_events, [SHOP, CALL])
  assertEquals((r.body.results as unknown[]).length, 2)
  assertEquals(r.res.headers.get('Access-Control-Allow-Origin'), null)
})

Deno.test('webhook: single { type, data } is accepted', async () => {
  const r = await deliver(SHOP)
  assertEquals(r.res.status, 200)
  assertEquals(r.db.args.jarvis_apply_events[0].p_events, [SHOP])
})

Deno.test('webhook: falls back to JARVIS_API_KEY', async () => {
  const r = await deliver(SHOP, { env: { JARVIS_API_KEY: 'api-key' }, secret: 'api-key' })
  assertEquals(r.res.status, 200)
  const wrong = await deliver(SHOP, { env: { JARVIS_WEBHOOK_SECRET: SECRET, JARVIS_API_KEY: 'api-key' }, secret: 'api-key' })
  assertEquals(wrong.res.status, 401)
})

Deno.test('webhook: no secret configured is 503, never accept-everything', async () => {
  const r = await deliver(SHOP, { env: {} })
  assertEquals(r.res.status, 503)
  assertEquals(r.db.opened, 0)
})

Deno.test('webhook: wrong/stale/future/malformed/missing signatures are 401, generic, nothing applied', async () => {
  const cases = [
    { secret: 'nope' },
    { t: T - 301 },
    { t: T + 301 },
    { header: 'garbage' },
    { header: '' },
    { header: `t=${T},v1=${'0'.repeat(64)}` },
  ]
  const messages = new Set<string>()
  for (const opts of cases) {
    const r = await deliver(SHOP, opts)
    assertEquals(r.res.status, 401)
    assertEquals(r.db.opened, 0)
    messages.add(JSON.stringify(r.body))
    assertEquals(r.logs.includes(SECRET), false)
  }
  assertEquals(messages.size, 1)
})

Deno.test('webhook: a tampered body fails', async () => {
  const raw = JSON.stringify(SHOP)
  const header = `t=${T},v1=${await sign(SECRET, T, new TextEncoder().encode(raw))}`
  const r = await deliver(null, { raw: raw.replace('Fade Lab', 'Evil Lab'), header })
  assertEquals(r.res.status, 401)
  assertEquals(r.db.opened, 0)
})

Deno.test('webhook: a replayed signature is refused by the replay guard', async () => {
  const replay = new ReplayGuard()
  const raw = JSON.stringify(SHOP)
  const header = `t=${T},v1=${await sign(SECRET, T, new TextEncoder().encode(raw))}`
  assertEquals((await deliver(null, { raw, header, replay })).res.status, 200)
  const again = await deliver(null, { raw, header, replay })
  assertEquals(again.res.status, 401)
  assertEquals(again.db.opened, 0)
})

Deno.test('webhook: a replay with a reordered or re-cased header is still refused', async () => {
  const replay = new ReplayGuard()
  const raw = JSON.stringify(SHOP)
  const hex = await sign(SECRET, T, new TextEncoder().encode(raw))
  assertEquals((await deliver(null, { raw, header: `t=${T},v1=${hex}`, replay })).res.status, 200)
  for (const header of [`v1=${hex},t=${T}`, `t=${T},v1=${hex.toUpperCase()}`, ` t=${T} , v1=${hex} `]) {
    const again = await deliver(null, { raw, header, replay })
    assertEquals(again.res.status, 401, header)
    assertEquals(again.db.opened, 0)
  }
})

Deno.test('webhook: a 5xx releases the signature so the sender can retry', async () => {
  const replay = new ReplayGuard()
  const raw = JSON.stringify(SHOP)
  const header = `t=${T},v1=${await sign(SECRET, T, new TextEncoder().encode(raw))}`
  const down = fakeDb({ jarvis_apply_events: () => ({ ok: false, error: { code: '08006', message: 'db down' } }) })
  assertEquals((await deliver(null, { raw, header, replay, db: down })).res.status, 500)
  assertEquals((await deliver(null, { raw, header, replay })).res.status, 200)
})

Deno.test('webhook: oversize body is 413 before anything else', async () => {
  const raw = JSON.stringify({ events: [{ type: 'shop.upsert', data: { name: 'x'.repeat(MAX_BODY_BYTES) } }] })
  const r = await deliver(null, { raw })
  assertEquals(r.res.status, 413)
  assertEquals(r.db.opened, 0)
})

Deno.test('webhook: non-POST is 405', async () => {
  for (const method of ['GET', 'PUT', 'OPTIONS']) {
    const r = await deliver(SHOP, { method })
    assertEquals(r.res.status, 405)
    assertEquals(r.db.opened, 0)
  }
})

Deno.test('webhook: malformed envelopes are 400 (after the signature)', async () => {
  for (const payload of [
    [SHOP], { events: SHOP }, { events: [] }, { events: [SHOP], extra: 1 }, { hello: 1 }, 'text', 42,
    { events: Array.from({ length: 101 }, () => SHOP) },
  ]) {
    const r = await deliver(payload)
    assertEquals(r.res.status, 400, JSON.stringify(payload).slice(0, 60))
    assertEquals(r.db.opened, 0)
  }
  const notJson = await deliver(null, { raw: '{"events": [' })
  assertEquals(notJson.res.status, 400)
  const exactly100 = await deliver({ events: Array.from({ length: 100 }, () => SHOP) })
  assertEquals(exactly100.res.status, 200)
})

Deno.test('webhook: mixed batch keeps original indexes and answers 422', async () => {
  const bad = { type: 'task.update', data: { task_id: 'not-a-uuid', status: 'done' } }
  const alert = { type: 'alert.create', data: { type: 'missed_call', title: 'Missed call', call_external_id: 'call-1' } }
  const r = await deliver({ events: [bad, SHOP, 'oops', alert] })
  assertEquals(r.res.status, 422)
  assertEquals(r.db.args.jarvis_apply_events[0].p_events, [SHOP, alert])
  const results = r.body.results as Record<string, unknown>[]
  assertEquals(results.map((x) => [x.index, x.type, x.ok]), [
    [0, 'task.update', false], [1, 'shop.upsert', true], [2, null, false], [3, 'alert.create', true],
  ])
  assertStringIncludes(results[0].error as string, 'task_id')
  assertEquals(results[3].notify, { channel: 'text', phone: '+15125550100', quiet_hours: false })
})

Deno.test('webhook: database per-event failures are remapped and give 422', async () => {
  const db = applyingDb((events) => ({
    ok: true,
    data: events.map((e, index) => index === 0
      ? { index, type: (e as { type: string }).type, ok: false, error: 'No shop with that phone number.' }
      : { index, type: (e as { type: string }).type, ok: true, id: U2 }),
  }))
  const r = await deliver({ events: ['bad', CALL, SHOP] }, { db })
  assertEquals(r.res.status, 422)
  const results = r.body.results as Record<string, unknown>[]
  assertEquals(results[1], { index: 1, type: 'call.upsert', ok: false, error: 'No shop with that phone number.' })
  assertEquals(results[2], { index: 2, type: 'shop.upsert', ok: true, id: U2 })
})

Deno.test('webhook: all invalid never calls the database', async () => {
  const r = await deliver({ events: [{ type: 'nope', data: {} }] })
  assertEquals(r.res.status, 422)
  assertEquals(r.db.opened, 0)
})

Deno.test('webhook: database error is a generic 500 without the raw message', async () => {
  const db = fakeDb({ jarvis_apply_events: () => ({ ok: false, error: { code: '42883', message: 'function secret_internal does not exist' } }) })
  const r = await deliver(SHOP, { db })
  assertEquals(r.res.status, 500)
  assertEquals(JSON.stringify(r.body).includes('secret_internal'), false)
  const short = fakeDb({ jarvis_apply_events: () => ({ ok: true, data: [] }) })
  assertEquals((await deliver(SHOP, { db: short })).res.status, 500)
})

Deno.test('webhook: logs never include the body, phones or transcript', async () => {
  const r = await deliver({ events: [CALL, { type: 'call.upsert', data: { ...CALL.data, caller_phone: 'x' } }] })
  assertEquals(r.logs.includes('+15125550150'), false)
  assertEquals(r.logs.includes('Hey'), false)
})

// ── Per-event validation ──────────────────────────────────────────────────

function expectOk(event: unknown) {
  const r = validateEvent(event)
  assertEquals(r.ok, true, r.ok ? '' : r.error)
}
function expectError(event: unknown, field: string) {
  const r = validateEvent(event)
  assertEquals(r.ok, false, JSON.stringify(event))
  if (!r.ok) assertStringIncludes(r.error, field)
}
const ev = (type: string, data: Record<string, unknown>) => ({ type, data })

Deno.test('validate: event envelope', () => {
  expectError('x', 'object')
  expectError({ data: {} }, 'type')
  expectError({ type: 'shop.upsert', data: [] }, 'data')
  expectError({ type: 'shop.upsert', data: {}, extra: 1 }, 'extra')
  expectError({ type: 'shop.delete', data: {} }, 'shop.delete')
})

Deno.test('validate: shop.upsert', () => {
  expectOk(SHOP)
  expectOk(ev('shop.upsert', { name: 'A', phone: '+15125550102', address: '1 Main', status: 'paused' }))
  expectError(ev('shop.upsert', { phone: '+15125550102' }), 'name')
  expectError(ev('shop.upsert', { name: 'A', phone: '512-555-0102' }), 'phone')
  expectError(ev('shop.upsert', { name: 'A', phone: '+15125550102', status: 'closed' }), 'status')
  expectError(ev('shop.upsert', { name: 'A', phone: '+15125550102', nmae: 'typo' }), 'nmae')
  expectError(ev('shop.upsert', { name: 'x'.repeat(201), phone: '+15125550102' }), 'name')
})

Deno.test('validate: call.upsert', () => {
  expectOk(CALL)
  const d = CALL.data
  expectOk(ev('call.upsert', { ...d, shop_phone: undefined, shop_id: U1 }))
  expectOk(ev('call.upsert', { ...d, transcript: null, summary: null }))
  expectError(ev('call.upsert', { ...d, shop_id: U1 }), 'not both')
  expectError(ev('call.upsert', { ...d, shop_phone: undefined }), 'shop_id')
  expectError(ev('call.upsert', { ...d, shop_phone: undefined, shop_id: 'abc' }), 'shop_id')
  expectError(ev('call.upsert', { ...d, outcome: 'hung_up' }), 'outcome')
  expectError(ev('call.upsert', { ...d, started_at: '2026-11-19 15:04' }), 'started_at')
  expectError(ev('call.upsert', { ...d, started_at: '2026-13-45T10:00:00Z' }), 'started_at')
  expectError(ev('call.upsert', { ...d, duration_seconds: 1.5 }), 'duration_seconds')
  expectError(ev('call.upsert', { ...d, duration_seconds: -1 }), 'duration_seconds')
  expectError(ev('call.upsert', { ...d, caller_phone: 'call me' }), 'caller_phone')
  expectError(ev('call.upsert', { ...d, external_id: '' }), 'external_id')
  expectError(ev('call.upsert', { ...d, transcript: [{ role: 'bot', text: 'x', t: 0 }] }), 'transcript')
  expectError(ev('call.upsert', { ...d, transcript: [{ role: 'agent', text: 'x', t: 0, extra: 1 }] }), 'transcript')
  expectError(ev('call.upsert', { ...d, transcript: 'hi' }), 'transcript')
})

Deno.test('validate: appointment.upsert', () => {
  const d = {
    external_id: 'appt-1', shop_phone: '+15125550101', customer_name: 'Sam', service: 'Fade',
    starts_at: '2026-11-20T10:00:00-06:00', duration_minutes: 30, status: 'booked', source: 'jarvis', call_external_id: 'call-1',
  }
  expectOk(ev('appointment.upsert', d))
  expectOk(ev('appointment.upsert', { ...d, call_external_id: undefined, call_id: U1 }))
  expectOk(ev('appointment.upsert', { ...d, call_external_id: undefined }))
  expectError(ev('appointment.upsert', { ...d, call_id: U1 }), 'not both')
  expectError(ev('appointment.upsert', { ...d, status: 'done' }), 'status')
  expectError(ev('appointment.upsert', { ...d, source: 'phone' }), 'source')
  expectError(ev('appointment.upsert', { ...d, duration_minutes: 0 }), 'duration_minutes')
  expectError(ev('appointment.upsert', { ...d, service: undefined }), 'service')
  expectError(ev('appointment.upsert', { ...d, customer_phone: '+1 (512)' }), 'customer_phone')
})

Deno.test('validate: task.update', () => {
  expectOk(ev('task.update', { task_id: U1, status: 'running', branch: 'jarvis/fix' }))
  expectOk(ev('task.update', { task_external_id: 'ext-9', pr_url: 'https://github.com/me/app/pull/1' }))
  expectError(ev('task.update', { task_id: U1 }), 'at least one')
  expectError(ev('task.update', { status: 'done' }), 'task_id')
  expectError(ev('task.update', { task_id: U1, task_external_id: 'x', status: 'done' }), 'not both')
  expectError(ev('task.update', { task_id: U1, status: 'finished' }), 'status')
  expectError(ev('task.update', { task_id: U1, started_at: '2026-11-19T15:04:05Z' }), 'started_at')
})

Deno.test('validate: task.event', () => {
  expectOk(ev('task.event', { task_id: U1, kind: 'log', message: 'npm test passed' }))
  expectOk(ev('task.event', { task_external_id: 'ext-9', kind: 'command', message: 'npm test', created_at: '2026-11-19T15:04:05.123+00:00' }))
  expectError(ev('task.event', { task_id: U1, kind: 'debug', message: 'x' }), 'kind')
  expectError(ev('task.event', { task_id: U1, kind: 'log' }), 'message')
  expectError(ev('task.event', { task_id: U1, kind: 'log', message: 'x', created_at: 'yesterday' }), 'created_at')
})

Deno.test('validate: approval.request', () => {
  expectOk(ev('approval.request', { kind: 'code', title: 'Merge?', task_id: U1 }))
  expectOk(ev('approval.request', { kind: 'spend', title: 'Buy clippers', shop_phone: '+15125550101', expires_at: '2026-11-20T00:00:00Z' }))
  expectOk(ev('approval.request', { kind: 'other', title: 'FYI' }))
  expectError(ev('approval.request', { kind: 'code', title: 'x', task_id: U1, task_external_id: 'e' }), 'not both')
  expectError(ev('approval.request', { kind: 'money', title: 'x' }), 'kind')
  expectError(ev('approval.request', { kind: 'code' }), 'title')
  expectError(ev('approval.request', { kind: 'code', title: 'x', status: 'pending' }), 'status')
})

Deno.test('validate: approval.expire', () => {
  expectOk(ev('approval.expire', { id: U1 }))
  expectError(ev('approval.expire', {}), 'id')
  expectError(ev('approval.expire', { id: '1' }), 'id')
  expectError(ev('approval.expire', { id: U1, approval_id: U1 }), 'approval_id')
})

Deno.test('validate: alert.create', () => {
  expectOk(ev('alert.create', { type: 'system', title: 'Backend restarted' }))
  expectOk(ev('alert.create', { type: 'approval_needed', title: 'x', approval_id: U1, task_external_id: 'e', shop_id: U2 }))
  expectError(ev('alert.create', { type: 'info', title: 'x' }), 'type')
  expectError(ev('alert.create', { type: 'system' }), 'title')
  expectError(ev('alert.create', { type: 'system', title: 'x', approval_id: 'abc' }), 'approval_id')
  expectError(ev('alert.create', { type: 'system', title: 'x', call_id: U1, call_external_id: 'c' }), 'not both')
  expectError(ev('alert.create', { type: 'system', title: 'x', channel: 'call' }), 'channel')
})
