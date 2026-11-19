import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import type { TestServer } from './helpers.ts'
import { cleanup, events, isoMinutesAgo, startServer } from './helpers.ts'

const DAY = 86_400_000
const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString()
const range = () => {
  const from = new Date(Date.now() - 6 * 3_600_000).toISOString()
  const to = new Date(Date.now() + 6 * 3_600_000).toISOString()
  return { from, to, query: `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` }
}

async function seed(server: TestServer) {
  const call = (id: string, shop: string, minutesAgo: number, outcome: string, extra: Record<string, unknown> = {}) => ({
    type: 'call.upsert',
    data: { external_id: id, shop_phone: shop, caller_phone: '+15125550123', started_at: isoMinutesAgo(minutesAgo), outcome, ...extra },
  })
  const result = await events(server, [
    { type: 'shop.upsert', data: { name: 'zed Barbers', phone: '+15125550101', timezone: 'America/Chicago' } },
    { type: 'shop.upsert', data: { name: 'Alpha Cuts', phone: '+15125550102' } },
    { type: 'shop.upsert', data: { name: 'Mid Fades', phone: '+15125550103' } },
    call('c1', '+15125550101', 10, 'booked', { transcript: [{ role: 'agent', text: 'Hello', t: 0 }, { role: 'caller', text: 'Hi', t: 1.5 }], summary: 'Booked a fade.' }),
    call('c2', '+15125550101', 20, 'answered'),
    call('c3', '+15125550101', 30, 'missed'),
    call('c4', '+15125550101', 40, 'failed'),
    call('c5', '+15125550101', 50, 'message'),
    call('c6', '+15125550101', 3 * 24 * 60, 'booked'), // outside today's range
    call('c7', '+15125550102', 15, 'transferred'),
    { type: 'appointment.upsert', data: { external_id: 'a1', shop_phone: '+15125550101', customer_name: 'Later', service: 'Cut', starts_at: inMinutes(300) } },
    { type: 'appointment.upsert', data: { external_id: 'a2', shop_phone: '+15125550101', customer_name: 'Soon', service: 'Cut', starts_at: inMinutes(60), status: 'confirmed', call_external_id: 'c1' } },
    { type: 'appointment.upsert', data: { external_id: 'a3', shop_phone: '+15125550101', customer_name: 'Gone', service: 'Cut', starts_at: inMinutes(30), status: 'cancelled' } },
    { type: 'appointment.upsert', data: { external_id: 'a4', shop_phone: '+15125550101', customer_name: 'Past', service: 'Cut', starts_at: isoMinutesAgo(30) } },
    { type: 'appointment.upsert', data: { external_id: 'a5', shop_phone: '+15125550101', customer_name: 'Done early', service: 'Cut', starts_at: inMinutes(10), status: 'completed' } },
  ])
  assert.equal(result.status, 200, JSON.stringify(result.body))
}

describe('the /app API', () => {
  let server: TestServer

  before(async () => {
    server = await startServer({ env: { ALLOWED_ORIGINS: 'https://jarvis-app.example.com' } })
    await seed(server)
  })
  after(async () => {
    await server.stop()
    cleanup(server.dataDir, server.staticDir)
  })

  describe('Home', () => {
    it('counts the brief from the same calls the lists show', async () => {
      const { query } = range()
      const brief = await server.api(`/app/brief?${query}`)
      assert.equal(brief.status, 200)
      // In range: c1 booked, c2 answered, c3 missed, c4 failed, c5 message, c7 transferred.
      assert.deepEqual(brief.body, { calls_answered: 4, bookings_made: 1, missed_calls: 2, tasks_finished: 0 })

      const shops = await server.api(`/app/shops?${query}`)
      const total = shops.body.shops.reduce(
        (sum: { calls: number; booked: number; missed: number }, shop: any) => ({
          calls: sum.calls + shop.calls_today,
          booked: sum.booked + shop.bookings_today,
          missed: sum.missed + shop.missed_today,
        }),
        { calls: 0, booked: 0, missed: 0 },
      )
      assert.equal(total.calls, brief.body.calls_answered + brief.body.missed_calls)
      assert.equal(total.booked, brief.body.bookings_made)
      assert.equal(total.missed, brief.body.missed_calls)
    })

    it('counts tasks finished today', async () => {
      await server.api('/app/settings', { method: 'PATCH', body: { allowed_repos: ['acme/site'] } })
      const created = await server.api('/app/tasks', { body: { repo: 'acme/site', instructions: 'Do it' } })
      await events(server, [{ type: 'task.update', data: { task_id: created.body.task.id, status: 'done' } }])
      const brief = await server.api(`/app/brief?${range().query}`)
      assert.equal(brief.body.tasks_finished, 1)
      const tomorrow = new Date(Date.now() + DAY).toISOString()
      const later = new Date(Date.now() + 2 * DAY).toISOString()
      const other = await server.api(`/app/brief?from=${encodeURIComponent(tomorrow)}&to=${encodeURIComponent(later)}`)
      assert.deepEqual(other.body, { calls_answered: 0, bookings_made: 0, missed_calls: 0, tasks_finished: 0 })
    })

    it('rejects a bad range', async () => {
      const res = await server.api('/app/brief?from=yesterday&to=today')
      assert.equal(res.status, 400)
      assert.equal(res.body.error.code, 'invalid')
      assert.equal((await server.api('/app/brief')).status, 200, 'both left out means the UTC day')
    })

    it('lists alerts newest first, with a limit, and marks them read once', async () => {
      const list = await server.api('/app/alerts')
      assert.equal(list.status, 200)
      // c3 (missed) and c4 (failed) raised alerts by themselves, plus the finished task.
      const types = list.body.alerts.map((alert: any) => alert.type)
      assert.deepEqual(types.slice().sort(), ['failed_call', 'missed_call', 'task_done'])
      const times = list.body.alerts.map((alert: any) => alert.created_at)
      assert.deepEqual(times, [...times].sort().reverse())
      assert.equal(list.body.alerts.find((alert: any) => alert.type === 'missed_call').channel, 'in_app', 'no phone on file')
      for (const key of ['id', 'type', 'title', 'body', 'shop_id', 'call_id', 'task_id', 'approval_id', 'channel', 'read_at', 'created_at']) {
        assert.ok(key in list.body.alerts[0], key)
      }

      assert.equal((await server.api('/app/alerts?limit=1')).body.alerts.length, 1)
      assert.equal((await server.api('/app/alerts?limit=500')).body.alerts.length, 3)
      assert.equal((await server.api('/app/alerts?limit=abc')).status, 400)

      const first = list.body.alerts[0]
      assert.equal((await server.api(`/app/alerts/${first.id}/read`, { method: 'POST' })).status, 204)
      const readAt = (await server.api('/app/alerts')).body.alerts.find((a: any) => a.id === first.id).read_at
      assert.ok(readAt)
      await new Promise((r) => setTimeout(r, 5))
      await server.api(`/app/alerts/${first.id}/read`, { method: 'POST' })
      assert.equal((await server.api('/app/alerts')).body.alerts.find((a: any) => a.id === first.id).read_at, readAt, 'first read time is kept')

      const missing = await server.api('/app/alerts/nope/read', { method: 'POST' })
      assert.equal(missing.status, 404)
      assert.equal(missing.body.error.code, 'not_found')

      assert.equal((await server.api('/app/alerts/read-all', { method: 'POST' })).status, 204)
      const after = (await server.api('/app/alerts')).body.alerts
      assert.ok(after.every((alert: any) => alert.read_at !== null))
      assert.equal(after.find((a: any) => a.id === first.id).read_at, readAt)
    })

    it('checks the approvals status filter', async () => {
      assert.equal((await server.api('/app/approvals?status=pending')).status, 200)
      const bad = await server.api('/app/approvals?status=maybe')
      assert.equal(bad.status, 400)
    })
  })

  describe('Receptionist', () => {
    it('lists shops by name with today’s counters and the next appointment', async () => {
      const res = await server.api(`/app/shops?${range().query}`)
      assert.equal(res.status, 200)
      assert.deepEqual(
        res.body.shops.map((shop: any) => shop.name),
        ['Alpha Cuts', 'Mid Fades', 'zed Barbers'],
      )
      const zed = res.body.shops[2]
      assert.equal(zed.calls_today, 5)
      assert.equal(zed.bookings_today, 1)
      assert.equal(zed.missed_today, 2)
      const appointments = await server.api(`/app/shops/${zed.id}/appointments`)
      const soonest = appointments.body.appointments.find((a: any) => a.status === 'booked' || a.status === 'confirmed')
      assert.equal(zed.next_appointment_at, soonest.starts_at)
      assert.equal(res.body.shops[1].next_appointment_at, null)
      for (const key of ['id', 'name', 'phone', 'address', 'timezone', 'status', 'created_at']) assert.ok(key in zed, key)
      assert.equal(zed.timezone, 'America/Chicago')
    })

    it('answers one shop, and 404 for an unknown one', async () => {
      const shops = (await server.api(`/app/shops?${range().query}`)).body.shops
      const one = await server.api(`/app/shops/${shops[0].id}?${range().query}`)
      assert.equal(one.status, 200)
      assert.deepEqual(one.body.shop, shops[0])
      const missing = await server.api('/app/shops/nope')
      assert.equal(missing.status, 404)
      assert.deepEqual(missing.body, { error: { code: 'not_found', message: 'Couldn’t find that shop.' } })
      assert.equal((await server.api('/app/shops/nope/calls')).status, 404)
      assert.equal((await server.api('/app/shops/nope/appointments')).status, 404)
    })

    it('lists upcoming appointments soonest first, without cancelled or past ones', async () => {
      const zed = (await server.api('/app/shops')).body.shops.find((s: any) => s.name === 'zed Barbers')
      const res = await server.api(`/app/shops/${zed.id}/appointments`)
      assert.deepEqual(
        res.body.appointments.map((a: any) => a.customer_name),
        ['Done early', 'Soon', 'Later'],
      )
      const soon = res.body.appointments[1]
      assert.equal(soon.status, 'confirmed')
      assert.equal(typeof soon.call_id, 'string')
      assert.equal(soon.duration_minutes, 30)
      assert.equal(soon.source, 'jarvis')
    })

    it('lists calls newest first, filters problems, and never includes transcripts', async () => {
      const zed = (await server.api('/app/shops')).body.shops.find((s: any) => s.name === 'zed Barbers')
      const all = await server.api(`/app/shops/${zed.id}/calls?filter=all`)
      assert.deepEqual(
        all.body.calls.map((c: any) => c.external_id),
        ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'],
      )
      assert.ok(all.body.calls.every((c: any) => !('transcript' in c)))
      const problems = await server.api(`/app/shops/${zed.id}/calls?filter=problems`)
      assert.deepEqual(problems.body.calls.map((c: any) => c.outcome), ['missed', 'failed'])
      assert.equal((await server.api(`/app/shops/${zed.id}/calls?filter=weird`)).status, 400)
    })

    it('answers one call with its transcript, and 404 for an unknown one', async () => {
      const zed = (await server.api('/app/shops')).body.shops.find((s: any) => s.name === 'zed Barbers')
      const calls = (await server.api(`/app/shops/${zed.id}/calls`)).body.calls
      const c1 = await server.api(`/app/calls/${calls[0].id}`)
      assert.equal(c1.status, 200)
      assert.deepEqual(c1.body.call.transcript, [
        { role: 'agent', text: 'Hello', t: 0 },
        { role: 'caller', text: 'Hi', t: 1.5 },
      ])
      assert.equal(c1.body.call.summary, 'Booked a fade.')
      assert.equal(c1.body.call.caller_name, null)
      const c2 = await server.api(`/app/calls/${calls[1].id}`)
      assert.deepEqual(c2.body.call.transcript, [])
      const missing = await server.api('/app/calls/nope')
      assert.deepEqual(missing.body, { error: { code: 'not_found', message: 'Couldn’t find that call.' } })
    })
  })

  describe('Memory', () => {
    it('creates, edits, lists and deletes handbook entries', async () => {
      const created = await server.api('/app/handbook', {
        body: { title: '  Prices ', category: 'Pricing', content: 'Fade $35', tags: ['money', ' money ', '', 'prices'], notion_page_id: 'evil' },
      })
      assert.equal(created.status, 201)
      const entry = created.body.entry
      assert.equal(entry.title, 'Prices')
      assert.deepEqual(entry.tags, ['money', 'prices'])
      assert.equal(entry.notion_page_id, null, 'never taken from the app')
      assert.equal(entry.created_at, entry.updated_at)

      const second = await server.api('/app/handbook', { body: { title: 'Hours', category: '', content: '', tags: [] } })
      assert.equal(second.body.entry.category, 'General')
      await new Promise((r) => setTimeout(r, 5))
      const edited = await server.api(`/app/handbook/${entry.id}`, {
        method: 'PUT',
        body: { title: 'Prices 2026', category: 'Pricing', content: 'Fade $38', tags: ['money'], notion_page_id: 'evil' },
      })
      assert.equal(edited.status, 200)
      assert.equal(edited.body.entry.title, 'Prices 2026')
      assert.equal(edited.body.entry.notion_page_id, null)
      assert.ok(edited.body.entry.updated_at > entry.updated_at)
      assert.equal(edited.body.entry.created_at, entry.created_at)

      const list = await server.api('/app/handbook')
      assert.deepEqual(list.body.entries.map((e: any) => e.title), ['Prices 2026', 'Hours'], 'most recently updated first')

      const noTitle = await server.api('/app/handbook', { body: { title: '  ', category: 'x', content: '', tags: [] } })
      assert.deepEqual(noTitle.body, { error: { code: 'invalid', message: 'Give the entry a title.' } })
      assert.equal((await server.api('/app/handbook', { body: { title: 'x', tags: 'nope' } })).status, 400)

      const missing = await server.api('/app/handbook/nope', { method: 'PUT', body: { title: 'x', category: '', content: '', tags: [] } })
      assert.deepEqual(missing.body, { error: { code: 'not_found', message: 'Couldn’t find that entry. It may have been deleted.' } })
      assert.equal((await server.api(`/app/handbook/${entry.id}`, { method: 'DELETE' })).status, 204)
      assert.equal((await server.api(`/app/handbook/${entry.id}`, { method: 'DELETE' })).status, 404)
    })

    it('creates, edits, orders and deletes decisions', async () => {
      const make = (title: string, decidedOn: string) =>
        server.api('/app/decisions', { body: { title, decision: 'Yes', rationale: null, decided_on: decidedOn, tags: [] } })
      const older = await make('Older', '2026-01-05')
      assert.equal(older.status, 201)
      assert.equal(older.body.decision.rationale, null)
      await make('Newest date', '2026-03-01')
      await new Promise((r) => setTimeout(r, 5))
      await make('Same day, created later', '2026-01-05')
      const list = await server.api('/app/decisions')
      assert.deepEqual(list.body.decisions.map((d: any) => d.title), ['Newest date', 'Same day, created later', 'Older'])

      const edited = await server.api(`/app/decisions/${older.body.decision.id}`, {
        method: 'PUT',
        body: { title: 'Older', decision: 'No', rationale: '  Because  ', decided_on: '2026-01-06', tags: ['a'] },
      })
      assert.equal(edited.body.decision.rationale, 'Because')
      assert.equal(edited.body.decision.decided_on, '2026-01-06')

      for (const [body, message] of [
        [{ title: '', decision: 'x', decided_on: '2026-01-01' }, 'Give the decision a title.'],
        [{ title: 'x', decision: ' ', decided_on: '2026-01-01' }, 'Write down what was decided.'],
        [{ title: 'x', decision: 'y', decided_on: '2026-02-30' }, 'Pick the date this was decided.'],
        [{ title: 'x', decision: 'y', decided_on: 'soon' }, 'Pick the date this was decided.'],
      ] as const) {
        const res = await server.api('/app/decisions', { body })
        assert.equal(res.status, 400)
        assert.equal(res.body.error.message, message)
      }
      const missing = await server.api('/app/decisions/nope', { method: 'DELETE' })
      assert.deepEqual(missing.body, { error: { code: 'not_found', message: 'Couldn’t find that decision. It may have been deleted.' } })
      assert.equal((await server.api(`/app/decisions/${older.body.decision.id}`, { method: 'DELETE' })).status, 204)
    })
  })

  describe('Settings', () => {
    it('answers the one settings record with every field', async () => {
      const res = await server.api('/app/settings')
      assert.equal(res.status, 200)
      const settings = res.body.settings
      for (const key of ['id', 'owner_id', 'notify_phone', 'notification_prefs', 'quiet_hours_enabled', 'quiet_hours_start', 'quiet_hours_end', 'timezone', 'allowed_repos', 'updated_at']) {
        assert.ok(key in settings, key)
      }
      const me = await server.api('/app/auth/me')
      assert.equal(settings.owner_id, me.body.user.id)
      assert.deepEqual(Object.keys(settings.notification_prefs).sort(), ['approval_needed', 'failed_call', 'missed_call', 'system', 'task_done', 'task_failed'])
    })

    it('patches only the fields sent, merges prefs, ignores the rest', async () => {
      const before = (await server.api('/app/settings')).body.settings
      await new Promise((r) => setTimeout(r, 5))
      const res = await server.api('/app/settings', {
        method: 'PATCH',
        body: {
          notify_phone: '+15125550100',
          notification_prefs: { task_done: 'call' },
          quiet_hours_enabled: true,
          quiet_hours_start: '23:30',
          quiet_hours_end: '06:15',
          timezone: 'America/Chicago',
          allowed_repos: [' acme/site ', 'acme/site', '', 'acme/api'],
          owner_id: 'someone-else',
          id: 'other',
          updated_at: '2000-01-01T00:00:00.000Z',
        },
      })
      assert.equal(res.status, 200)
      const after = res.body.settings
      assert.equal(after.notify_phone, '+15125550100')
      assert.equal(after.notification_prefs.task_done, 'call')
      assert.equal(after.notification_prefs.missed_call, before.notification_prefs.missed_call)
      assert.equal(after.quiet_hours_enabled, true)
      assert.equal(after.quiet_hours_start, '23:30')
      assert.equal(after.quiet_hours_end, '06:15')
      assert.equal(after.timezone, 'America/Chicago')
      assert.deepEqual(after.allowed_repos, ['acme/site', 'acme/api'])
      assert.equal(after.owner_id, before.owner_id)
      assert.equal(after.id, before.id)
      assert.ok(after.updated_at > before.updated_at)
      assert.deepEqual((await server.api('/app/repos')).body.repos, ['acme/site', 'acme/api'])

      const cleared = await server.api('/app/settings', { method: 'PATCH', body: { notify_phone: null } })
      assert.equal(cleared.body.settings.notify_phone, null)
      const unchanged = await server.api('/app/settings', { method: 'PATCH', body: { nothing: true } })
      assert.equal(unchanged.status, 200)
    })

    it('rejects bad values with a sentence saying which', async () => {
      const cases: [Record<string, unknown>, RegExp][] = [
        [{ notify_phone: '512-555-0100' }, /phone number/],
        [{ notification_prefs: { missed_call: 'pigeon' } }, /missed_call/],
        [{ notification_prefs: { lunch: 'text' } }, /isn’t an alert type/],
        [{ notification_prefs: 'text' }, /Notification preferences/],
        [{ quiet_hours_enabled: 'yes' }, /Quiet hours/],
        [{ quiet_hours_start: '25:00' }, /start/],
        [{ quiet_hours_end: '7am' }, /end/],
        [{ timezone: 'Mars/Olympus' }, /time zone/],
        [{ allowed_repos: 'acme/site' }, /list/],
        [{ allowed_repos: ['not a repo'] }, /owner\/name/],
      ]
      for (const [body, message] of cases) {
        const res = await server.api('/app/settings', { method: 'PATCH', body })
        assert.equal(res.status, 400, JSON.stringify(body))
        assert.equal(res.body.error.code, 'invalid')
        assert.match(res.body.error.message, message)
      }
    })
  })

  describe('Connections and voice without keys', () => {
    it('always answers four entries in order', async () => {
      const res = await server.api('/app/connections')
      assert.equal(res.status, 200)
      assert.deepEqual(res.body.connections.map((c: any) => c.service), ['elevenlabs', 'twilio', 'notion', 'jarvis'])
      assert.deepEqual(res.body.connections.map((c: any) => c.state), ['not_configured', 'not_configured', 'not_configured', 'connected'])
      for (const entry of res.body.connections) {
        assert.equal(typeof entry.detail, 'string')
        assert.ok('latency_ms' in entry)
        assert.ok(Date.parse(entry.checked_at))
      }
    })

    it('voice says it isn’t set up yet', async () => {
      const res = await server.api('/app/voice/session', { method: 'POST' })
      assert.equal(res.status, 503)
      assert.deepEqual(res.body, { error: { code: 'not_configured', message: 'Voice isn’t set up yet. Add your ElevenLabs key to the Jarvis backend.' } })
    })
  })

  describe('Plumbing', () => {
    it('answers unknown endpoints as not built, wrong methods as 405', async () => {
      const unknown = await server.api('/app/nothing-here')
      assert.equal(unknown.status, 404)
      assert.equal(unknown.body.error.code, 'not_configured')
      const method = await server.api('/app/brief', { method: 'DELETE' })
      assert.equal(method.status, 405)
    })

    it('rejects bad JSON and oversized bodies', async () => {
      const bad = await server.api('/app/handbook', { body: '{"title": ' })
      assert.equal(bad.status, 400)
      assert.equal(bad.body.error.code, 'invalid')
      const big = await server.api('/app/handbook', { body: { title: 'x', content: 'y'.repeat(300 * 1024) } })
      assert.equal(big.status, 413)
      const array = await server.api('/app/handbook', { body: '[1,2]' })
      assert.equal(array.status, 400)
    })

    it('answers CORS preflights for the allowed origin only', async () => {
      const ok = await fetch(`${server.url}/app/brief`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://jarvis-app.example.com', 'Access-Control-Request-Method': 'GET' },
      })
      assert.equal(ok.status, 204)
      assert.equal(ok.headers.get('access-control-allow-origin'), 'https://jarvis-app.example.com')
      assert.match(ok.headers.get('access-control-allow-headers') ?? '', /Authorization/)
      assert.equal(ok.headers.get('vary'), 'Origin')
      const error = await server.api('/app/brief', { token: null, headers: { Origin: 'https://jarvis-app.example.com' } })
      assert.equal(error.status, 401)
      assert.equal(error.headers.get('access-control-allow-origin'), 'https://jarvis-app.example.com', 'errors carry CORS headers too')

      const evil = await fetch(`${server.url}/app/brief`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example.com' } })
      assert.equal(evil.headers.get('access-control-allow-origin'), null)
    })

    it('puts security headers on every response', async () => {
      for (const path of ['/app/brief', '/healthz', '/', '/assets/index-AbC123xY.js', '/hooks/events']) {
        const res = await fetch(`${server.url}${path}`)
        assert.match(res.headers.get('content-security-policy') ?? '', /connect-src 'self' https:\/\/api\.elevenlabs\.io wss:\/\/api\.elevenlabs\.io/, path)
        assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
        assert.equal(res.headers.get('x-frame-options'), 'DENY')
        assert.equal(res.headers.get('referrer-policy'), 'no-referrer')
        await res.arrayBuffer()
      }
    })

    it('answers /healthz', async () => {
      const res = await fetch(`${server.url}/healthz`)
      assert.equal(res.status, 200)
      assert.deepEqual(await res.json(), { ok: true })
    })
  })
})
