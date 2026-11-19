import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import type { TestServer } from './helpers.ts'
import { cleanup, events, isoMinutesAgo, postHook, signature, startServer, WEBHOOK_SECRET } from './helpers.ts'

const SHOP = '+15125550100'

describe('POST /hooks/events', () => {
  let server: TestServer
  before(async () => {
    server = await startServer()
    await server.api('/app/settings', { method: 'PATCH', body: { allowed_repos: ['acme/site'] } })
  })
  after(async () => {
    await server.stop()
    cleanup(server.dataDir, server.staticDir)
  })

  describe('signature', () => {
    const payload = { type: 'shop.upsert', data: { name: 'Sig Shop', phone: '+15125550199' } }

    it('accepts a valid signature', async () => {
      const res = await postHook(server, payload)
      assert.equal(res.status, 200)
      assert.equal(res.body.results[0].ok, true)
    })

    it('refuses a missing, malformed or wrong signature with 401', async () => {
      for (const header of [null, '', 'v1=abc', 't=123', 'garbage', signature('wrong-secret', JSON.stringify(payload))]) {
        const res = await postHook(server, payload, { header })
        assert.equal(res.status, 401, String(header))
        assert.equal(res.body.error.code, 'unauthorized')
      }
    })

    it('refuses a tampered body', async () => {
      const signed = JSON.stringify(payload)
      const header = signature(WEBHOOK_SECRET, signed)
      const res = await postHook(server, null, { header, raw: signed.replace('Sig Shop', 'Evil Shop') })
      assert.equal(res.status, 401)
    })

    it('refuses stale and future timestamps (more than 5 minutes off)', async () => {
      const now = Math.floor(Date.now() / 1000)
      assert.equal((await postHook(server, payload, { t: now - 301 })).status, 401)
      assert.equal((await postHook(server, payload, { t: now + 301 })).status, 401)
      assert.equal((await postHook(server, payload, { t: now - 290 })).status, 200)
    })

    it('refuses an exact replay', async () => {
      const raw = JSON.stringify({ type: 'shop.upsert', data: { name: 'Replay', phone: '+15125550198' } })
      const header = signature(WEBHOOK_SECRET, raw)
      assert.equal((await postHook(server, null, { raw, header })).status, 200)
      const again = await postHook(server, null, { raw, header })
      assert.equal(again.status, 409)
    })

    it('refuses bodies over 1 MB', async () => {
      const raw = JSON.stringify({ type: 'shop.upsert', data: { name: 'x'.repeat(1024 * 1024), phone: '+15125550197' } })
      const res = await postHook(server, null, { raw })
      assert.equal(res.status, 413)
    })

    it('says so when no webhook secret is configured', async () => {
      const bare = await startServer({ env: { JARVIS_WEBHOOK_SECRET: '' }, owner: false })
      try {
        const res = await postHook(bare, payload)
        assert.equal(res.status, 503)
        assert.equal(res.body.error.code, 'not_configured')
      } finally {
        await bare.stop()
        cleanup(bare.dataDir, bare.staticDir)
      }
    })

    it('only takes POST', async () => {
      const res = await fetch(`${server.url}/hooks/events`)
      assert.equal(res.status, 405)
      assert.equal((await fetch(`${server.url}/hooks/nothing`, { method: 'POST' })).status, 404)
    })
  })

  describe('envelope', () => {
    it('refuses malformed envelopes with 400', async () => {
      for (const body of [[], { events: 'x' }, { events: [] }, { events: [], extra: 1 }, { nothing: true }, { events: Array.from({ length: 101 }, () => ({})) }]) {
        const res = await postHook(server, body)
        assert.equal(res.status, 400, JSON.stringify(body).slice(0, 60))
        assert.equal(res.body.error.code, 'invalid')
      }
      const notJson = await postHook(server, null, { raw: '{not json' })
      assert.equal(notJson.status, 400)
    })

    it('applies events in order, reports each, and answers 422 when one failed', async () => {
      const res = await events(server, [
        { type: 'shop.upsert', data: { name: 'Main St', phone: SHOP, timezone: 'America/Chicago' } },
        { type: 'task.update', data: { task_id: 'no-such-task', status: 'running' } },
        { type: 'shop.upsert', data: { name: 'Main St Barbers', phone: SHOP } },
        { type: 'nope.event', data: {} },
        { type: 'shop.upsert', data: { name: 'x', phone: SHOP, colour: 'red' } },
        { type: 'call.upsert', data: { external_id: 'x', shop_id: 'a', shop_phone: SHOP, caller_phone: '+1', started_at: isoMinutesAgo(1), outcome: 'booked' } },
        { type: 'shop.upsert', extra: true, data: {} },
      ])
      assert.equal(res.status, 422)
      const results = res.body.results
      assert.deepEqual(results.map((r: any) => [r.index, r.type, r.ok]), [
        [0, 'shop.upsert', true],
        [1, 'task.update', false],
        [2, 'shop.upsert', true],
        [3, 'nope.event', false],
        [4, 'shop.upsert', false],
        [5, 'call.upsert', false],
        [6, 'shop.upsert', false],
      ])
      assert.equal(results[1].error, 'No task with that id.')
      assert.match(results[3].error, /Unknown event type/)
      assert.match(results[4].error, /Unknown field "colour"/)
      assert.match(results[5].error, /Send only one of "shop_id" or "shop_phone"/)
      assert.match(results[6].error, /Unknown field "extra"/)
      assert.equal(results[0].id, results[2].id, 'the same phone updates the same shop')
      const shop = (await server.api('/app/shops')).body.shops.find((s: any) => s.phone === SHOP)
      assert.equal(shop.name, 'Main St Barbers')
      assert.equal(shop.timezone, 'America/Chicago', 'fields not sent are kept')
    })
  })

  describe('every event type', () => {
    it('call.upsert creates, then updates by external_id', async () => {
      const base = { external_id: 'CA-1', shop_phone: SHOP, caller_phone: '+15125550123', started_at: isoMinutesAgo(5), outcome: 'answered' }
      const first = await events(server, [{ type: 'call.upsert', data: { ...base, caller_name: 'Ana', summary: 'Asked about hours.' } }])
      assert.equal(first.status, 200)
      const id = first.body.results[0].id
      const second = await events(server, [
        { type: 'call.upsert', data: { ...base, outcome: 'booked', duration_seconds: 94, transcript: [{ role: 'caller', text: 'Hi', t: 0 }] } },
      ])
      assert.equal(second.body.results[0].id, id)
      const call = (await server.api(`/app/calls/${id}`)).body.call
      assert.equal(call.outcome, 'booked')
      assert.equal(call.caller_name, 'Ana', 'kept when not sent')
      assert.equal(call.summary, 'Asked about hours.')
      assert.equal(call.duration_seconds, 94)
      assert.equal(call.transcript.length, 1)
      const bad = await events(server, [{ type: 'call.upsert', data: { ...base, transcript: [{ role: 'robot', text: 'x', t: 0 }] } }])
      assert.match(bad.body.results[0].error, /Turn 1 of "transcript"/)
      const noShop = await events(server, [{ type: 'call.upsert', data: { ...base, shop_phone: '+15125550000' } }])
      assert.equal(noShop.body.results[0].error, 'No shop with that phone number. Send shop.upsert first.')
    })

    it('appointment.upsert creates, links a call by its external id, then updates', async () => {
      const base = { external_id: 'appt-1', shop_phone: SHOP, customer_name: 'Ana', service: 'Fade', starts_at: new Date(Date.now() + 3_600_000).toISOString() }
      const first = await events(server, [{ type: 'appointment.upsert', data: { ...base, call_external_id: 'CA-1', barber: 'Dre' } }])
      assert.equal(first.status, 200)
      const second = await events(server, [{ type: 'appointment.upsert', data: { ...base, status: 'confirmed', duration_minutes: 45 } }])
      assert.equal(second.body.results[0].id, first.body.results[0].id)
      const shop = (await server.api('/app/shops')).body.shops.find((s: any) => s.phone === SHOP)
      const appt = (await server.api(`/app/shops/${shop.id}/appointments`)).body.appointments.find((a: any) => a.external_id === 'appt-1')
      assert.equal(appt.status, 'confirmed')
      assert.equal(appt.duration_minutes, 45)
      assert.equal(appt.barber, 'Dre')
      assert.ok(appt.call_id)
      const bad = await events(server, [{ type: 'appointment.upsert', data: { ...base, status: 'maybe' } }])
      assert.match(bad.body.results[0].error, /not a valid status/)
    })

    it('task.update and task.event change a task and add to its log', async () => {
      const task = (await server.api('/app/tasks', { body: { repo: 'acme/site', instructions: 'Hooked task' } })).body.task
      const res = await events(server, [
        { type: 'task.update', data: { task_id: task.id, external_id: 'ext-9', status: 'running', title: 'Renamed' } },
        { type: 'task.event', data: { task_external_id: 'ext-9', kind: 'command', message: 'npm test' } },
        { type: 'task.event', data: { task_id: task.id, kind: 'log', message: 'All green', created_at: new Date(Date.now() + 1000).toISOString() } },
        { type: 'task.update', data: { task_id: task.id } },
      ])
      assert.equal(res.body.results[3].ok, false)
      assert.match(res.body.results[3].error, /needs at least one field/)
      const stored = (await server.api(`/app/tasks/${task.id}`)).body.task
      assert.equal(stored.title, 'Renamed')
      assert.equal(stored.external_id, 'ext-9')
      const log = (await server.api(`/app/tasks/${task.id}/events`)).body.events.map((e: any) => [e.kind, e.message])
      assert.deepEqual(log.slice(-2), [
        ['command', 'npm test'],
        ['log', 'All green'],
      ])
    })

    it('approval.request makes the task wait and raises an alert; approval.expire expires it', async () => {
      const task = (await server.api('/app/tasks', { body: { repo: 'acme/site', instructions: 'Needs a yes' } })).body.task
      await events(server, [{ type: 'task.update', data: { task_id: task.id, status: 'running' } }])
      const asked = await events(server, [
        { type: 'approval.request', data: { kind: 'code', title: 'Open a PR?', detail: '2 files', task_id: task.id, expires_at: new Date(Date.now() + 86_400_000).toISOString() } },
      ])
      const approvalId = asked.body.results[0].id
      assert.equal((await server.api(`/app/tasks/${task.id}`)).body.task.status, 'needs_approval')
      const approval = (await server.api('/app/approvals?status=pending')).body.approvals.find((a: any) => a.id === approvalId)
      assert.equal(approval.task_id, task.id)
      assert.ok(approval.expires_at)
      const alert = (await server.api('/app/alerts')).body.alerts.find((a: any) => a.approval_id === approvalId)
      assert.equal(alert.type, 'approval_needed')

      const expired = await events(server, [{ type: 'approval.expire', data: { id: approvalId } }])
      assert.equal(expired.status, 200)
      assert.equal((await server.api('/app/approvals?status=expired')).body.approvals.some((a: any) => a.id === approvalId), true)
      const again = await postHook(server, { type: 'approval.expire', data: { id: approvalId } })
      assert.equal(again.status, 200, 'expiring twice is fine')

      const decidedId = (await events(server, [{ type: 'approval.request', data: { kind: 'spend', title: 'Buy?', shop_phone: SHOP } }])).body.results[0].id
      await server.api(`/app/approvals/${decidedId}/decision`, { body: { decision: 'approved' } })
      const late = await events(server, [{ type: 'approval.expire', data: { id: decidedId } }])
      assert.equal(late.body.results[0].error, 'That approval was already approved, so it cannot expire.')
      const missing = await events(server, [{ type: 'approval.expire', data: { id: 'nope' } }])
      assert.equal(missing.body.results[0].error, 'No approval with that id.')
    })

    it('alert.create stores the alert with the routed channel and returns notify', async () => {
      await server.api('/app/settings', {
        method: 'PATCH',
        body: { notify_phone: '+15125550100', notification_prefs: { system: 'call', missed_call: 'text' }, quiet_hours_enabled: false },
      })
      const res = await events(server, [
        { type: 'alert.create', data: { type: 'system', title: 'Disk almost full', body: '91% used' } },
        { type: 'alert.create', data: { type: 'missed_call', title: 'Missed call', call_external_id: 'CA-1' } },
        { type: 'alert.create', data: { type: 'task_done', title: 'Done', approval_id: 'nope' } },
      ])
      assert.equal(res.status, 422)
      assert.deepEqual(res.body.results[0].notify, { channel: 'call', phone: '+15125550100', quiet_hours: false })
      assert.deepEqual(res.body.results[1].notify, { channel: 'text', phone: '+15125550100', quiet_hours: false })
      assert.equal(res.body.results[2].error, 'No approval with that id.')
      const alerts = (await server.api('/app/alerts')).body.alerts
      const system = alerts.find((a: any) => a.id === res.body.results[0].id)
      assert.equal(system.channel, 'call')
      assert.equal(system.body, '91% used')
      const missed = alerts.find((a: any) => a.id === res.body.results[1].id)
      const shop = (await server.api('/app/shops')).body.shops.find((s: any) => s.phone === SHOP)
      assert.equal(missed.shop_id, shop.id, 'an alert about a call belongs to its shop')

      // Quiet hours all day long: calls and texts become in_app.
      await server.api('/app/settings', { method: 'PATCH', body: { quiet_hours_enabled: true, quiet_hours_start: '00:00', quiet_hours_end: '23:59', timezone: 'UTC' } })
      const quiet = await events(server, [{ type: 'alert.create', data: { type: 'system', title: 'Late night' } }])
      const now = new Date()
      const lastMinute = now.getUTCHours() === 23 && now.getUTCMinutes() === 59
      if (!lastMinute) assert.deepEqual(quiet.body.results[0].notify, { channel: 'in_app', phone: '+15125550100', quiet_hours: true })

      await server.api('/app/settings', { method: 'PATCH', body: { quiet_hours_enabled: false, notify_phone: null } })
      const noPhone = await events(server, [{ type: 'alert.create', data: { type: 'system', title: 'No phone' } }])
      assert.deepEqual(noPhone.body.results[0].notify, { channel: 'in_app', phone: null, quiet_hours: false })
    })
  })
})
