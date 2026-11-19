import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import type { TestServer, Upstream } from './helpers.ts'
import { cleanup, events, sleep, startServer, startUpstream } from './helpers.ts'

async function until<T>(read: () => Promise<T>, test: (value: T) => boolean, timeoutMs = 3000): Promise<T> {
  const started = Date.now()
  for (;;) {
    const value = await read()
    if (test(value)) return value
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting; last value ${JSON.stringify(value)}`)
    await sleep(20)
  }
}

describe('coding tasks without a runner', () => {
  let server: TestServer
  before(async () => {
    server = await startServer()
    await server.api('/app/settings', { method: 'PATCH', body: { allowed_repos: ['acme/site'] } })
  })
  after(async () => {
    await server.stop()
    cleanup(server.dataDir, server.staticDir)
  })

  it('validates the repo and instructions', async () => {
    const cases: [unknown, string][] = [
      [{ repo: '', instructions: 'x' }, 'Pick a repo for Jarvis to work in.'],
      [{ repo: 'other/repo', instructions: 'x' }, 'Jarvis can’t work in other/repo. Pick one of your allowed repos, or add it in Settings.'],
      [{ repo: 'acme/site', instructions: '   ' }, 'Write what you want Jarvis to do.'],
      [{ repo: 'acme/site', instructions: 'x'.repeat(8001) }, 'Keep the instructions under 8,000 characters.'],
    ]
    for (const [body, message] of cases) {
      const res = await server.api('/app/tasks', { body })
      assert.equal(res.status, 400)
      assert.deepEqual(res.body, { error: { code: 'invalid', message } })
    }
  })

  it('saves a queued task with a title from the first line, logs Queued, and says no runner is connected', async () => {
    const instructions = `  Add a "next free slot" badge to every barber card on the booking page so people can see availability\nSecond line`
    const res = await server.api('/app/tasks', { body: { repo: 'acme/site', instructions } })
    assert.equal(res.status, 201)
    const task = res.body.task
    assert.equal(task.status, 'queued')
    assert.equal(task.title, 'Add a "next free slot" badge to every barber card on the booking page…')
    assert.ok(task.title.length <= 73)
    assert.equal(task.instructions, instructions.trim())
    for (const key of ['external_id', 'branch', 'result_summary', 'pr_url', 'error', 'started_at', 'finished_at']) assert.equal(task[key], null, key)

    const log = await until(
      async () => (await server.api(`/app/tasks/${task.id}/events`)).body.events,
      (list: any[]) => list.length >= 2,
    )
    assert.deepEqual(
      log.map((e: any) => [e.kind, e.message]),
      [
        ['status', 'Queued'],
        ['log', 'No task runner is connected yet. This task will wait in the queue.'],
      ],
    )
    assert.equal((await server.api(`/app/tasks/${task.id}`)).body.task.status, 'queued')
  })

  it('lists tasks newest first and 404s unknown ones', async () => {
    await sleep(5)
    await server.api('/app/tasks', { body: { repo: 'acme/site', instructions: 'Second task' } })
    const list = (await server.api('/app/tasks')).body.tasks
    assert.equal(list[0].title, 'Second task')
    const missing = await server.api('/app/tasks/nope')
    assert.deepEqual(missing.body, { error: { code: 'not_found', message: 'Couldn’t find that task.' } })
    assert.equal((await server.api('/app/tasks/nope/events')).status, 404)
    assert.equal((await server.api('/app/tasks/nope/cancel', { method: 'POST' })).status, 404)
  })

  it('stamps started_at once, finished_at at the end, and keeps a finished status', async () => {
    const task = (await server.api('/app/tasks', { body: { repo: 'acme/site', instructions: 'Lifecycle' } })).body.task
    await events(server, [{ type: 'task.update', data: { task_id: task.id, status: 'running', branch: 'jarvis/lifecycle' } }])
    const running = (await server.api(`/app/tasks/${task.id}`)).body.task
    assert.equal(running.status, 'running')
    assert.ok(running.started_at)
    assert.equal(running.branch, 'jarvis/lifecycle')
    assert.equal(running.finished_at, null)
    assert.ok(running.updated_at >= task.updated_at)

    await sleep(5)
    await events(server, [{ type: 'task.update', data: { task_id: task.id, status: 'running' } }])
    assert.equal((await server.api(`/app/tasks/${task.id}`)).body.task.started_at, running.started_at, 'started_at is stamped only once')

    await events(server, [{ type: 'task.update', data: { task_id: task.id, status: 'done', result_summary: 'Shipped.', pr_url: 'https://github.com/acme/site/pull/1' } }])
    const done = (await server.api(`/app/tasks/${task.id}`)).body.task
    assert.equal(done.status, 'done')
    assert.ok(done.finished_at)

    const late = await events(server, [{ type: 'task.update', data: { task_id: task.id, status: 'running', result_summary: 'Shipped, really.' } }])
    assert.equal(late.status, 200)
    const still = (await server.api(`/app/tasks/${task.id}`)).body.task
    assert.equal(still.status, 'done', 'a finished task keeps its status')
    assert.equal(still.finished_at, done.finished_at)
    assert.equal(still.result_summary, 'Shipped, really.', 'other fields are still stored')

    const alert = (await server.api('/app/alerts')).body.alerts.find((a: any) => a.task_id === task.id)
    assert.equal(alert.type, 'task_done')
    assert.equal(alert.body, 'Shipped.')

    const cancel = await server.api(`/app/tasks/${task.id}/cancel`, { method: 'POST' })
    assert.equal(cancel.status, 409)
    assert.deepEqual(cancel.body, { error: { code: 'invalid', message: 'This task has already finished.' } })
  })

  it('cancels an active task, expires its pending approvals and logs it', async () => {
    const task = (await server.api('/app/tasks', { body: { repo: 'acme/site', instructions: 'To cancel' } })).body.task
    const asked = await events(server, [{ type: 'approval.request', data: { kind: 'code', title: 'Push it?', task_id: task.id } }])
    const approvalId = asked.body.results[0].id
    assert.equal((await server.api(`/app/tasks/${task.id}`)).body.task.status, 'needs_approval')

    const res = await server.api(`/app/tasks/${task.id}/cancel`, { method: 'POST' })
    assert.equal(res.status, 200)
    assert.equal(res.body.task.status, 'cancelled')
    assert.ok(res.body.task.finished_at)
    const approval = (await server.api('/app/approvals')).body.approvals.find((a: any) => a.id === approvalId)
    assert.equal(approval.status, 'expired')
    const log = (await server.api(`/app/tasks/${task.id}/events`)).body.events
    assert.deepEqual(log.at(-1), { ...log.at(-1), kind: 'status', message: 'Cancelled by you' })
    const times = log.map((e: any) => e.created_at)
    assert.deepEqual(times, [...times].sort(), 'events oldest first')
  })

  it('approving a waiting task puts it back to running; denying cancels it', async () => {
    const one = (await server.api('/app/tasks', { body: { repo: 'acme/site', instructions: 'Approve me' } })).body.task
    const two = (await server.api('/app/tasks', { body: { repo: 'acme/site', instructions: 'Deny me' } })).body.task
    await events(server, [{ type: 'task.update', data: { task_id: one.id, status: 'running' } }])
    const asked = await events(server, [
      { type: 'approval.request', data: { kind: 'code', title: 'Push one?', detail: '3 files', task_id: one.id } },
      { type: 'approval.request', data: { kind: 'code', title: 'Push two?', task_id: two.id } },
    ])
    const [first, second] = asked.body.results.map((r: any) => r.id)

    const pending = (await server.api('/app/approvals?status=pending')).body.approvals
    assert.deepEqual(pending.slice(0, 2).map((a: any) => a.id), [second, first], 'newest first')

    const approved = await server.api(`/app/approvals/${first}/decision`, { body: { decision: 'approved' } })
    assert.equal(approved.status, 200)
    assert.equal(approved.body.approval.status, 'approved')
    assert.ok(approved.body.approval.decided_at)
    const runningAgain = (await server.api(`/app/tasks/${one.id}`)).body.task
    assert.equal(runningAgain.status, 'running')
    assert.equal((await server.api(`/app/tasks/${one.id}/events`)).body.events.at(-1).message, 'Approved by you')

    const denied = await server.api(`/app/approvals/${second}/decision`, { body: { decision: 'denied' } })
    assert.equal(denied.body.approval.status, 'denied')
    const cancelled = (await server.api(`/app/tasks/${two.id}`)).body.task
    assert.equal(cancelled.status, 'cancelled')
    assert.ok(cancelled.finished_at)
    assert.equal((await server.api(`/app/tasks/${two.id}/events`)).body.events.at(-1).message, 'Denied by you')

    const again = await server.api(`/app/approvals/${first}/decision`, { body: { decision: 'denied' } })
    assert.equal(again.status, 409)
    assert.equal(again.body.error.message, 'This was already decided.')

    const missing = await server.api('/app/approvals/nope/decision', { body: { decision: 'approved' } })
    assert.deepEqual(missing.body, { error: { code: 'not_found', message: 'Couldn’t find that request. It may have been withdrawn.' } })

    const other = (await events(server, [{ type: 'approval.request', data: { kind: 'spend', title: 'Spend $20?' } }])).body.results[0].id
    const bad = await server.api(`/app/approvals/${other}/decision`, { body: { decision: 'maybe' } })
    assert.equal(bad.status, 400)
  })

  it('an approval past its expires_at can no longer be decided', async () => {
    const soon = new Date(Date.now() + 1000).toISOString()
    const id = (await events(server, [{ type: 'approval.request', data: { kind: 'other', title: 'Quick?', expires_at: soon } }])).body.results[0].id
    await sleep(1100)
    const res = await server.api(`/app/approvals/${id}/decision`, { body: { decision: 'approved' } })
    assert.equal(res.status, 409)
    assert.equal(res.body.error.message, 'This request has expired.')
    const approval = (await server.api('/app/approvals?status=expired')).body.approvals.find((a: any) => a.id === id)
    assert.equal(approval.status, 'expired')
  })
})

describe('coding tasks with a runner', () => {
  let server: TestServer
  let runner: Upstream

  before(async () => {
    runner = await startUpstream()
    runner.routes.set('GET /health', () => ({ status: 200, body: { ok: true } }))
    runner.routes.set('POST /tasks/', (request) => (request.path.endsWith('/cancel') ? { status: 200, body: {} } : undefined))
    runner.routes.set('POST /tasks', (request) => {
      const body = JSON.parse(request.body)
      if (body.instructions.includes('refuse')) return { status: 422, body: { error: 'That repo is archived.' } }
      if (body.instructions.includes('flaky')) return { status: 503 }
      return { status: 201, body: { external_id: `run-${body.task_id.slice(0, 8)}` } }
    })
    runner.routes.set('POST /approvals/', (request) => (request.body.includes('"denied"') && request.path.includes('fail') ? undefined : { status: 200, body: {} }))
    server = await startServer({ env: { TASK_RUNNER_URL: `${runner.url}/`, TASK_RUNNER_KEY: 'runner-key' } })
    await server.api('/app/settings', { method: 'PATCH', body: { allowed_repos: ['acme/site'] } })
  })
  after(async () => {
    await server.stop()
    await runner.close()
    cleanup(server.dataDir, server.staticDir)
  })

  it('sends a new task to the runner with the documented body and stores its external id', async () => {
    const task = (await server.api('/app/tasks', { body: { repo: 'acme/site', instructions: 'Fix the footer' } })).body.task
    const stored = await until(
      async () => (await server.api(`/app/tasks/${task.id}`)).body.task,
      (t: any) => t.external_id !== null,
    )
    assert.equal(stored.external_id, `run-${task.id.slice(0, 8)}`)
    const sent = runner.requests.find((r) => r.method === 'POST' && r.path === '/tasks')!
    assert.equal(sent.headers.authorization, 'Bearer runner-key')
    assert.equal(sent.headers['content-type'], 'application/json')
    assert.deepEqual(JSON.parse(sent.body), { task_id: task.id, title: 'Fix the footer', repo: 'acme/site', instructions: 'Fix the footer' })
    const log = (await server.api(`/app/tasks/${task.id}/events`)).body.events
    assert.deepEqual(log.map((e: any) => e.message), ['Queued', 'Sent to the task runner.'])

    // The runner reports back by its own id.
    const progress = await events(server, [
      { type: 'task.update', data: { task_external_id: stored.external_id, status: 'running' } },
      { type: 'task.event', data: { task_external_id: stored.external_id, kind: 'command', message: 'npm test' } },
    ])
    assert.equal(progress.status, 200)
    assert.equal((await server.api(`/app/tasks/${task.id}`)).body.task.status, 'running')
  })

  it('fails a task the runner turns down, with its reason', async () => {
    const task = (await server.api('/app/tasks', { body: { repo: 'acme/site', instructions: 'Please refuse this' } })).body.task
    const failed = await until(async () => (await server.api(`/app/tasks/${task.id}`)).body.task, (t: any) => t.status === 'failed')
    assert.equal(failed.error, 'The task runner turned this task down: That repo is archived.')
    assert.ok(failed.finished_at)
    const log = (await server.api(`/app/tasks/${task.id}/events`)).body.events
    assert.equal(log.at(-1).kind, 'error')
    const alert = (await server.api('/app/alerts')).body.alerts.find((a: any) => a.task_id === task.id)
    assert.equal(alert.type, 'task_failed')
  })

  it('keeps a task queued when the runner is down, and says it will retry', async () => {
    const task = (await server.api('/app/tasks', { body: { repo: 'acme/site', instructions: 'A flaky one' } })).body.task
    const log = await until(async () => (await server.api(`/app/tasks/${task.id}/events`)).body.events, (list: any[]) => list.length >= 2)
    assert.equal(log[1].kind, 'error')
    assert.match(log[1].message, /Jarvis will keep trying every minute/)
    assert.equal((await server.api(`/app/tasks/${task.id}`)).body.task.status, 'queued')
  })

  it('tells the runner about cancels and approval decisions', async () => {
    const task = (await server.api('/app/tasks', { body: { repo: 'acme/site', instructions: 'Cancel me later' } })).body.task
    await server.api(`/app/tasks/${task.id}/cancel`, { method: 'POST' })
    await until(async () => runner.requests.some((r) => r.path === `/tasks/${task.id}/cancel`), Boolean)
    const cancel = runner.requests.find((r) => r.path === `/tasks/${task.id}/cancel`)!
    assert.equal(cancel.body, '{}')

    const waiting = (await server.api('/app/tasks', { body: { repo: 'acme/site', instructions: 'Ask me' } })).body.task
    const approvalId = (await events(server, [{ type: 'approval.request', data: { kind: 'code', title: 'Merge?', task_id: waiting.id } }])).body.results[0].id
    const res = await server.api(`/app/approvals/${approvalId}/decision`, { body: { decision: 'approved' } })
    assert.equal(res.status, 200)
    const told = runner.requests.find((r) => r.path === `/approvals/${approvalId}/decision`)!
    assert.deepEqual(JSON.parse(told.body), { decision: 'approved', task_id: waiting.id })
  })

  it('records nothing when the runner can’t take a decision', async () => {
    runner.routes.set('POST /approvals/', () => ({ status: 500 }))
    const waiting = (await server.api('/app/tasks', { body: { repo: 'acme/site', instructions: 'Ask again' } })).body.task
    const approvalId = (await events(server, [{ type: 'approval.request', data: { kind: 'code', title: 'Merge again?', task_id: waiting.id } }])).body.results[0].id
    const res = await server.api(`/app/approvals/${approvalId}/decision`, { body: { decision: 'denied' } })
    assert.equal(res.status, 502)
    assert.equal(res.body.error.code, 'upstream')
    const approval = (await server.api('/app/approvals')).body.approvals.find((a: any) => a.id === approvalId)
    assert.equal(approval.status, 'pending')
    assert.equal((await server.api(`/app/tasks/${waiting.id}`)).body.task.status, 'needs_approval')
  })

  it('reports the runner in Settings → Connections', async () => {
    const jarvis = (await server.api('/app/connections')).body.connections[3]
    assert.equal(jarvis.service, 'jarvis')
    assert.equal(jarvis.state, 'connected')
    assert.equal(jarvis.detail, 'Database OK. The task runner is up.')
    runner.routes.set('GET /health', () => ({ status: 500 }))
    const down = (await server.api('/app/connections')).body.connections[3]
    assert.equal(down.state, 'error')
    assert.match(down.detail, /task runner answered with an error/)
  })
})
