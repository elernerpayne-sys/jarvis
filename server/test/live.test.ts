import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { request } from 'node:http'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import type { TestServer } from './helpers.ts'
import { cleanup, events, fakeDist, isoMinutesAgo, openStream, OWNER, sleep, startServer, tempDir } from './helpers.ts'

const APP_ROOT = fileURLToPath(new URL('../..', import.meta.url))

describe('live updates (/app/events)', () => {
  let server: TestServer
  before(async () => {
    server = await startServer({ env: { SSE_HEARTBEAT_MS: '200' } })
    await server.api('/app/settings', { method: 'PATCH', body: { allowed_repos: ['acme/site'] } })
  })
  after(async () => {
    await server.stop()
    cleanup(server.dataDir, server.staticDir)
  })

  it('needs a valid token', async () => {
    const stream = await openStream(server, '', 'garbage')
    assert.equal(stream.status, 401)
  })

  it('opens with the right headers and sends heartbeats', async () => {
    const stream = await openStream(server, '?tables=tasks')
    assert.equal(stream.status, 200)
    assert.match(stream.headers.get('content-type') ?? '', /^text\/event-stream/)
    assert.match(stream.headers.get('cache-control') ?? '', /no-cache/)
    assert.equal(stream.headers.get('x-accel-buffering'), 'no')
    await sleep(450)
    assert.ok(stream.comments.includes('ping'), `comments: ${stream.comments.join(',')}`)
    stream.close()
  })

  it('delivers a change for owner actions, webhook pushes and the task runner', async () => {
    const stream = await openStream(server, '?tables=tasks,task_events,approvals,alerts,calls,appointments')
    const created = (await server.api('/app/tasks', { body: { repo: 'acme/site', instructions: 'Live one' } })).body.task

    const insert = await stream.waitFor((c) => c.table === 'tasks' && c.type === 'INSERT' && c.id === created.id)
    assert.deepEqual(insert.row, created)
    await stream.waitFor((c) => c.table === 'task_events' && c.row?.task_id === created.id && c.row.message === 'Queued')
    // The dispatcher (no runner here) writes its own log line, which also goes live.
    await stream.waitFor((c) => c.table === 'task_events' && c.row?.task_id === created.id && /No task runner/.test(c.row.message))

    await events(server, [
      { type: 'shop.upsert', data: { name: 'Live Shop', phone: '+15125550111' } },
      {
        type: 'call.upsert',
        data: { external_id: 'live-1', shop_phone: '+15125550111', caller_phone: '+15125550123', started_at: isoMinutesAgo(1), outcome: 'missed', transcript: [{ role: 'agent', text: 'Hi', t: 0 }] },
      },
    ])
    const call = await stream.waitFor((c) => c.table === 'calls' && c.row?.external_id === 'live-1')
    assert.equal(call.type, 'INSERT')
    assert.ok(!('transcript' in call.row), 'calls go live without their transcript')
    await stream.waitFor((c) => c.table === 'alerts' && c.row?.call_id === call.id)

    await server.api(`/app/tasks/${created.id}/cancel`, { method: 'POST' })
    const cancelled = await stream.waitFor((c) => c.table === 'tasks' && c.type === 'UPDATE' && c.row?.status === 'cancelled')
    assert.equal(cancelled.id, created.id)
    stream.close()
  })

  it('sends only the tables asked for', async () => {
    const stream = await openStream(server, '?tables=alerts')
    await server.api('/app/tasks', { body: { repo: 'acme/site', instructions: 'Not for this stream' } })
    await events(server, [{ type: 'alert.create', data: { type: 'system', title: 'For this stream' } }])
    await stream.waitFor((c) => c.table === 'alerts' && c.row?.title === 'For this stream')
    assert.ok(stream.received.every((c) => c.table === 'alerts'))
    stream.close()
  })

  it('ends the stream when its session signs out', async () => {
    const login = await server.api('/app/auth/login', { body: OWNER, token: null })
    const stream = await openStream(server, '', login.body.token)
    assert.equal(stream.status, 200)
    await server.api('/app/auth/logout', { method: 'POST', token: login.body.token })
    await Promise.race([stream.ended, sleep(2000).then(() => assert.fail('the stream stayed open'))])
  })
})

function rawGet(url: string, path: string): Promise<{ status: number; body: string }> {
  const { hostname, port } = new URL(url)
  return new Promise((resolve, reject) => {
    const req = request({ hostname, port, path, method: 'GET' }, (res) => {
      let body = ''
      res.on('data', (chunk) => (body += chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
    })
    req.on('error', reject)
    req.end()
  })
}

describe('serving the app', () => {
  let server: TestServer
  before(async () => {
    server = await startServer({ owner: false })
  })
  after(async () => {
    await server.stop()
    cleanup(server.dataDir, server.staticDir)
  })

  it('serves index.html at / and for client-side routes', async () => {
    for (const path of ['/', '/code', '/receptionist/shop-1/calls/abc', '/settings']) {
      const res = await fetch(`${server.url}${path}`)
      assert.equal(res.status, 200, path)
      assert.match(res.headers.get('content-type') ?? '', /text\/html/)
      assert.equal(res.headers.get('cache-control'), 'no-cache')
      assert.match(await res.text(), /<div id="root">/)
    }
  })

  it('caches hashed assets for a year and revalidates the service worker', async () => {
    const asset = await fetch(`${server.url}/assets/index-AbC123xY.js`)
    assert.equal(asset.status, 200)
    assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable')
    assert.match(asset.headers.get('content-type') ?? '', /javascript/)
    await asset.text()
    const sw = await fetch(`${server.url}/sw.js`)
    assert.equal(sw.headers.get('cache-control'), 'no-cache')
    await sw.text()
    const manifest = await fetch(`${server.url}/manifest.webmanifest`)
    assert.equal(manifest.headers.get('cache-control'), 'no-cache')
    assert.match(manifest.headers.get('content-type') ?? '', /manifest\+json/)
    await manifest.text()
  })

  it('compresses text when the browser accepts it', async () => {
    const res = await new Promise<{ encoding: string | undefined }>((resolve, reject) => {
      const { hostname, port } = new URL(server.url)
      request({ hostname, port, path: '/assets/index-AbC123xY.js', headers: { 'Accept-Encoding': 'gzip' } }, (r) => {
        r.resume()
        resolve({ encoding: r.headers['content-encoding'] })
      })
        .on('error', reject)
        .end()
    })
    assert.equal(res.encoding, 'gzip')
  })

  it('404s missing files and refuses to leave the app folder', async () => {
    assert.equal((await fetch(`${server.url}/assets/missing-12345678.js`)).status, 404)
    const escape = await rawGet(server.url, '/../../../etc/passwd')
    assert.notEqual(escape.status, 500)
    assert.ok(!escape.body.includes('root:'))
    const encoded = await rawGet(server.url, '/%2e%2e/%2e%2e/etc/passwd')
    assert.ok(!encoded.body.includes('root:'))
  })

  it('does not fall back to the app for API paths', async () => {
    const res = await fetch(`${server.url}/app/whatever`)
    assert.equal(res.status, 401)
    assert.match(res.headers.get('content-type') ?? '', /json/)
  })
})

describe('persistence', () => {
  it('keeps everything, including sessions, across a restart', async () => {
    const dataDir = tempDir()
    const staticDir = fakeDist()
    const first = await startServer({ dataDir, staticDir })
    await first.api('/app/settings', { method: 'PATCH', body: { allowed_repos: ['acme/site'], timezone: 'America/Chicago' } })
    const task = (await first.api('/app/tasks', { body: { repo: 'acme/site', instructions: 'Survive a restart' } })).body.task
    const entry = (await first.api('/app/handbook', { body: { title: 'Kept', category: 'x', content: 'y', tags: ['z'] } })).body.entry
    await events(first, [{ type: 'shop.upsert', data: { name: 'Persisted', phone: '+15125550155' } }])
    const token = first.token
    await sleep(50)
    await first.stop()

    const second = await startServer({ dataDir, staticDir, owner: false })
    try {
      assert.equal((await second.api('/app/auth/me', { token })).status, 200, 'the session survives')
      assert.equal((await second.api(`/app/tasks/${task.id}`, { token })).body.task.title, 'Survive a restart')
      assert.deepEqual((await second.api('/app/handbook', { token })).body.entries[0], entry)
      assert.equal((await second.api('/app/settings', { token })).body.settings.timezone, 'America/Chicago')
      assert.ok((await second.api('/app/shops', { token })).body.shops.some((s: any) => s.name === 'Persisted'))
      const log = (await second.api(`/app/tasks/${task.id}/events`, { token })).body.events
      assert.ok(log.length >= 1)
    } finally {
      await second.stop()
      cleanup(dataDir, staticDir)
    }
  })
})

describe('the command line', () => {
  const run = (args: string[], env: Record<string, string>, input?: string) =>
    new Promise<{ code: number | null; out: string }>((resolve) => {
      const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', ...args], {
        cwd: APP_ROOT,
        env: { ...process.env, JARVIS_LOG: '', ...env },
      })
      let out = ''
      child.stdout.on('data', (chunk) => (out += chunk))
      child.stderr.on('data', (chunk) => (out += chunk))
      if (input !== undefined) child.stdin.end(input)
      child.on('close', (code) => resolve({ code, out }))
    })

  it('creates the owner, seeds and clears sample data, starts, and stops cleanly', async () => {
    const dataDir = tempDir()
    const staticDir = fakeDist()
    const env = { DATA_DIR: dataDir, STATIC_DIR: staticDir }
    let child: ReturnType<typeof spawn> | null = null
    try {
      const bad = await run(['server/scripts/owner.ts', '--email', 'nope'], env)
      assert.equal(bad.code, 2)
      const short = await run(['server/scripts/owner.ts', '--email', OWNER.email, '--password', 'short'], env)
      assert.equal(short.code, 1)
      const created = await run(['server/scripts/owner.ts', '--email', OWNER.email], env, `${OWNER.password}\n`)
      assert.equal(created.code, 0, created.out)
      assert.match(created.out, /Owner created/)
      const updated = await run(['server/scripts/owner.ts', '--email', OWNER.email, '--password', OWNER.password], env)
      assert.match(updated.out, /Owner updated/)

      const seeded = await run(['server/scripts/seed.ts'], env)
      assert.equal(seeded.code, 0, seeded.out)
      assert.match(seeded.out, /Loaded sample data: 3 shops/)

      child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/src/main.ts'], {
        cwd: APP_ROOT,
        env: { ...process.env, JARVIS_LOG: '', ...env, PORT: '0', HOST: '127.0.0.1' },
      })
      let out = ''
      const server = child
      server.stdout!.on('data', (chunk) => (out += chunk))
      server.stderr!.on('data', (chunk) => (out += chunk))
      const port = await new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no port in: ${out}`)), 5000)
        server.stdout!.on('data', () => {
          const match = /listening on port (\d+)/.exec(out)
          if (match) {
            clearTimeout(timer)
            resolve(Number(match[1]))
          }
        })
      })
      const url = `http://127.0.0.1:${port}`
      assert.equal((await fetch(`${url}/healthz`)).status, 200)
      const login = await fetch(`${url}/app/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(OWNER) })
      const { token } = (await login.json()) as { token: string }
      const shops = (await (await fetch(`${url}/app/shops`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { shops: { name: string }[] }
      assert.deepEqual(shops.shops.map((s) => s.name), ['Burnet Road Barbers', 'Fade House', 'South Lamar Shave Parlor'])
      const repos = (await (await fetch(`${url}/app/repos`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { repos: string[] }
      assert.ok(repos.repos.length > 0, 'sample repos are allowed so a task can be started')
      assert.ok(!out.includes(OWNER.password), 'no secrets in the log')

      const exited = new Promise<number | null>((resolve) => server.on('close', resolve))
      server.kill('SIGTERM')
      assert.equal(await exited, 0)
      child = null
      assert.match(out, /SIGTERM: shutting down/)

      const cleared = await run(['server/scripts/seed.ts', '--clear'], env)
      assert.equal(cleared.code, 0, cleared.out)
      assert.match(cleared.out, /Removed \d+ sample rows/)
    } finally {
      child?.kill('SIGKILL')
      cleanup(dataDir, staticDir)
    }
  })
})
