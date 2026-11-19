import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { handleCommand } from '../jarvis-command/handler.ts'
import type { DbResult } from '../_shared/db.ts'
import { bodyOf, captureLogs, envOf, fakeAuth, fakeDb, fakeFetch, json, post, type Route } from './helpers.ts'

const TASK_ID = '33333333-3333-4333-8333-333333333333'
const APPROVAL_ID = '44444444-4444-4444-8444-444444444444'
const API_KEY = 'jv-backend-secret'
const READY = envOf({ JARVIS_API_URL: 'https://jarvis.example.com/', JARVIS_API_KEY: API_KEY })
const NONE = envOf({})

const task = (extra: Record<string, unknown> = {}) => ({
  id: TASK_ID, title: 'Fix it', repo: 'me/app', instructions: 'Fix it', status: 'queued', ...extra,
})
const ok = (data: unknown): DbResult<unknown> => ({ ok: true, data })
const fail = (code: string, message: string): DbResult<unknown> => ({ ok: false, error: { code, message } })

function taskDb() {
  return fakeDb({
    jarvis_create_task: () => ok(task()),
    jarvis_record_dispatch: (a) =>
      ok(task({
        status: a.p_outcome === 'rejected' ? 'failed' : 'queued',
        external_id: a.p_external_id,
        error: a.p_detail,
      })),
    jarvis_cancel_task: () => ok(task({ status: 'cancelled' })),
    jarvis_decide_approval: (a) => ok({ id: APPROVAL_ID, status: a.p_decision, task_id: TASK_ID }),
  }, {
    [`approvals:${APPROVAL_ID}`]: { id: APPROVAL_ID, status: 'pending', task_id: TASK_ID },
  })
}

async function send(body: unknown, env = READY, route: Route = () => json({}), db = taskDb()) {
  const out = fakeFetch({ 'https://jarvis.example.com/': route })
  const { result, logs } = await captureLogs(async () => {
    const res = await handleCommand(post(body), {
      env, fetch: out.fetch, auth: fakeAuth(), db: db.db, backendTimeoutMs: 50,
    })
    return { res, body: await bodyOf(res) }
  })
  return { ...result, out, db, logs }
}

const CREATE = { action: 'create_task', repo: 'me/app', instructions: 'Fix it' }

Deno.test('create_task accepted: hands off with bearer key, records external_id', async () => {
  const r = await send(CREATE, READY, () => json({ external_id: 'ext-9' }))
  assertEquals(r.res.status, 200)
  assertEquals(r.db.log, ['rpc:jarvis_create_task', 'rpc:jarvis_record_dispatch'])
  assertEquals(r.db.args.jarvis_create_task[0], { p_repo: 'me/app', p_instructions: 'Fix it' })
  assertEquals(r.db.args.jarvis_record_dispatch[0], {
    p_task_id: TASK_ID, p_outcome: 'accepted', p_external_id: 'ext-9', p_detail: null,
  })
  assertEquals(r.out.calls[0].url, 'https://jarvis.example.com/tasks')
  const headers = r.out.calls[0].init.headers as Record<string, string>
  assertEquals(headers.Authorization, `Bearer ${API_KEY}`)
  assertEquals(JSON.parse(r.out.calls[0].init.body as string), {
    task_id: TASK_ID, title: 'Fix it', repo: 'me/app', instructions: 'Fix it',
  })
  assertEquals((r.body.task as { external_id: string }).external_id, 'ext-9')
})

Deno.test('create_task accepted without a body records a null external_id', async () => {
  const r = await send(CREATE, READY, () => new Response(null, { status: 202 }))
  assertEquals(r.db.args.jarvis_record_dispatch[0].p_external_id, null)
  assertEquals(r.db.args.jarvis_record_dispatch[0].p_outcome, 'accepted')
})

Deno.test('create_task not configured: no outbound call, records not_configured', async () => {
  for (const env of [NONE, envOf({ JARVIS_API_URL: 'https://jarvis.example.com' })]) {
    const r = await send(CREATE, env)
    assertEquals(r.res.status, 200)
    assertEquals(r.out.calls.length, 0)
    assertEquals(r.db.args.jarvis_record_dispatch[0].p_outcome, 'not_configured')
  }
})

Deno.test('create_task rejected: down, timeout, non-2xx, bad URL; no secret in the detail', async () => {
  const cases: [Route, string][] = [
    [() => 'throw', "couldn't be reached"],
    [() => 'hang', "didn't answer"],
    [() => json({ error: `boom ${API_KEY}` }, 500), 'HTTP 500'],
    [() => json({}, 401), 'JARVIS_API_KEY'],
  ]
  for (const [route, phrase] of cases) {
    const r = await send(CREATE, READY, route)
    assertEquals(r.res.status, 200)
    const recorded = r.db.args.jarvis_record_dispatch[0]
    assertEquals(recorded.p_outcome, 'rejected')
    assertStringIncludes(recorded.p_detail as string, phrase)
    assertEquals(JSON.stringify(r.body).includes(API_KEY), false)
    assertEquals(r.logs.includes(API_KEY), false)
    assertEquals((r.body.task as { status: string }).status, 'failed')
  }
  const bad = await send(CREATE, envOf({ JARVIS_API_URL: 'ftp://x', JARVIS_API_KEY: API_KEY }))
  assertEquals(bad.db.args.jarvis_record_dispatch[0].p_outcome, 'rejected')
  assertEquals(bad.out.calls.length, 0)
})

Deno.test('create_task unanswered hand-off sends a follow-up cancel', async () => {
  const r = await send(CREATE, READY, () => 'throw')
  assertEquals(r.out.calls.map((c) => c.url), [
    'https://jarvis.example.com/tasks',
    `https://jarvis.example.com/tasks/${TASK_ID}/cancel`,
  ])
})

Deno.test('create_task: SQLSTATE mapping and input checks', async () => {
  const db = (code: string) => fakeDb({ jarvis_create_task: () => fail(code, 'That repository is not allowed.') })
  const r400 = await send(CREATE, READY, undefined, db('JV400'))
  assertEquals(r400.res.status, 400)
  assertEquals(r400.body.error, { code: 'invalid', message: 'That repository is not allowed.' })
  assertEquals(r400.out.calls.length, 0)
  const r500 = await send(CREATE, READY, undefined, db('42501'))
  assertEquals(r500.res.status, 500)
  assertEquals((r500.body.error as { message: string }).message.includes('repository'), false)

  for (const body of [
    { action: 'create_task', repo: 'me/app' },
    { action: 'create_task', repo: '', instructions: 'x' },
    { action: 'create_task', repo: 'me/app', instructions: '   ' },
    { action: 'create_task', repo: 'me/app', instructions: 'x'.repeat(8001) },
    { action: 'explode' },
    [1, 2],
    'text',
  ]) {
    const r = await send(body)
    assertEquals(r.res.status, 400)
    assertEquals(r.db.log, [])
  }
})

Deno.test('cancel_task: database first, backend best effort', async () => {
  const r = await send({ action: 'cancel_task', task_id: TASK_ID }, READY, () => 'throw')
  assertEquals(r.res.status, 200)
  assertEquals((r.body.task as { status: string }).status, 'cancelled')
  assertEquals(r.out.calls[0].url, `https://jarvis.example.com/tasks/${TASK_ID}/cancel`)
  const quiet = await send({ action: 'cancel_task', task_id: TASK_ID }, NONE)
  assertEquals(quiet.res.status, 200)
  assertEquals(quiet.out.calls.length, 0)
})

Deno.test('cancel_task: JV404 / JV409 / bad id', async () => {
  for (const [code, status] of [['JV404', 404], ['JV409', 409]] as const) {
    const db = fakeDb({ jarvis_cancel_task: () => fail(code, 'Too late.') })
    const r = await send({ action: 'cancel_task', task_id: TASK_ID }, READY, undefined, db)
    assertEquals(r.res.status, status)
    assertEquals(r.body.error, { code: code === 'JV404' ? 'not_found' : 'invalid', message: 'Too late.' })
    assertEquals(r.out.calls.length, 0)
  }
  const bad = await send({ action: 'cancel_task', task_id: '../../admin' })
  assertEquals(bad.res.status, 400)
  assertEquals(bad.out.calls.length, 0)
})

Deno.test('decide_approval: backend first, then the database', async () => {
  const r = await send({ action: 'decide_approval', approval_id: APPROVAL_ID, decision: 'approved' })
  assertEquals(r.res.status, 200)
  assertEquals(r.db.log, ['find:approvals', 'rpc:jarvis_decide_approval'])
  assertEquals(r.out.calls[0].url, `https://jarvis.example.com/approvals/${APPROVAL_ID}/decision`)
  assertEquals(JSON.parse(r.out.calls[0].init.body as string), { decision: 'approved', task_id: TASK_ID })
  assertEquals((r.body.approval as { status: string }).status, 'approved')
})

Deno.test('decide_approval: backend failure records nothing and is 502', async () => {
  for (const route of [() => 'throw' as const, () => 'hang' as const, () => json({}, 503)]) {
    const r = await send({ action: 'decide_approval', approval_id: APPROVAL_ID, decision: 'denied' }, READY, route)
    assertEquals(r.res.status, 502)
    assertEquals((r.body.error as { code: string }).code, 'upstream')
    assertEquals(r.db.log, ['find:approvals'])
  }
})

Deno.test('decide_approval: not configured records without calling out', async () => {
  const r = await send({ action: 'decide_approval', approval_id: APPROVAL_ID, decision: 'denied' }, NONE)
  assertEquals(r.res.status, 200)
  assertEquals(r.out.calls.length, 0)
  assertEquals(r.db.log, ['find:approvals', 'rpc:jarvis_decide_approval'])
})

Deno.test('decide_approval: missing 404, not pending 409, bad decision 400, JV409 race', async () => {
  const missing = await send({ action: 'decide_approval', approval_id: TASK_ID, decision: 'approved' })
  assertEquals(missing.res.status, 404)
  assertEquals(missing.out.calls.length, 0)

  const decided = fakeDb({}, { [`approvals:${APPROVAL_ID}`]: { id: APPROVAL_ID, status: 'approved', task_id: null } })
  const late = await send({ action: 'decide_approval', approval_id: APPROVAL_ID, decision: 'denied' }, READY, undefined, decided)
  assertEquals(late.res.status, 409)
  assertEquals((late.body.error as { code: string }).code, 'invalid')
  assertEquals(late.out.calls.length, 0)

  const bad = await send({ action: 'decide_approval', approval_id: APPROVAL_ID, decision: 'maybe' })
  assertEquals(bad.res.status, 400)

  const race = fakeDb(
    { jarvis_decide_approval: () => fail('JV409', 'That approval was already decided.') },
    { [`approvals:${APPROVAL_ID}`]: { id: APPROVAL_ID, status: 'pending', task_id: null } },
  )
  const r = await send({ action: 'decide_approval', approval_id: APPROVAL_ID, decision: 'denied' }, NONE, undefined, race)
  assertEquals(r.res.status, 409)
  assert(String((r.body.error as { message: string }).message).includes('already decided'))
})
