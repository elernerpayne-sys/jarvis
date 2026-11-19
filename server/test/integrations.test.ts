import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { mapPostCall } from '../src/elevenlabs-hook.ts'
import type { TestServer, Upstream } from './helpers.ts'
import { cleanup, ELEVENLABS_SECRET, events, signature, sleep, startServer, startUpstream } from './helpers.ts'

const SHOP_PHONE = '+15125550142'
const TWILIO_SID = `AC${'a'.repeat(32)}`

/** A post-call webhook body in the shape this server assumes ElevenLabs sends (see src/elevenlabs-hook.ts). */
function postCallBody(overrides: { conversationId?: string; agentNumber?: string | null; transcript?: unknown[]; dataCollection?: unknown } = {}) {
  const start = Math.floor(Date.now() / 1000) - 120
  return {
    type: 'post_call_transcription',
    event_timestamp: start + 100,
    data: {
      agent_id: 'agent_123',
      conversation_id: overrides.conversationId ?? 'conv_abc',
      status: 'done',
      transcript: overrides.transcript ?? [
        { role: 'agent', message: 'Thanks for calling Fade House, how can I help?', time_in_call_secs: 0 },
        { role: 'user', message: 'Can I get a fade tomorrow at ten?', time_in_call_secs: 3 },
        { role: 'agent', message: null, time_in_call_secs: 5, tool_calls: [{ name: 'book' }] },
        { role: 'agent', message: 'You are booked for 10 AM tomorrow.', time_in_call_secs: 41 },
      ],
      metadata: {
        start_time_unix_secs: start,
        call_duration_secs: 52,
        phone_call: { direction: 'inbound', agent_number: overrides.agentNumber === undefined ? SHOP_PHONE : overrides.agentNumber, external_number: '+15125550177', call_sid: 'CA123', type: 'twilio' },
      },
      analysis: {
        call_successful: 'success',
        transcript_summary: 'The caller booked a fade for tomorrow at 10 AM.',
        data_collection_results: overrides.dataCollection ?? { outcome: { value: 'booked' }, caller_name: { value: 'Marcus Lee' } },
      },
      conversation_initiation_client_data: { dynamic_variables: { system__called_number: SHOP_PHONE, system__caller_id: '+15125550177' } },
    },
  }
}

async function postElevenLabs(server: TestServer, body: unknown, options: { secret?: string; t?: number; header?: string | null } = {}) {
  const raw = JSON.stringify(body)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const header = options.header === undefined ? signature(options.secret ?? ELEVENLABS_SECRET, raw, options.t, 'v0') : options.header
  if (header !== null) headers['ElevenLabs-Signature'] = header
  const res = await fetch(`${server.url}/hooks/elevenlabs`, { method: 'POST', headers, body: raw })
  return { status: res.status, body: (await res.json()) as any }
}

describe('mapping an ElevenLabs post-call body', () => {
  it('turns it into a call', () => {
    const call = mapPostCall(postCallBody())!
    assert.equal(call.external_id, 'conv_abc')
    assert.equal(call.called_number, SHOP_PHONE)
    assert.equal(call.caller_phone, '+15125550177')
    assert.equal(call.caller_name, 'Marcus Lee')
    assert.equal(call.outcome, 'booked')
    assert.equal(call.duration_seconds, 52)
    assert.equal(call.summary, 'The caller booked a fade for tomorrow at 10 AM.')
    assert.deepEqual(call.transcript, [
      { role: 'agent', text: 'Thanks for calling Fade House, how can I help?', t: 0 },
      { role: 'caller', text: 'Can I get a fade tomorrow at ten?', t: 3 },
      { role: 'agent', text: 'You are booked for 10 AM tomorrow.', t: 41 },
    ])
  })

  it('guesses the outcome when the agent collected none', () => {
    assert.equal(mapPostCall(postCallBody({ dataCollection: {} }))!.outcome, 'answered')
    assert.equal(mapPostCall(postCallBody({ dataCollection: {}, transcript: [{ role: 'agent', message: 'Hello?', time_in_call_secs: 0 }] }))!.outcome, 'missed')
    const failed = postCallBody()
    failed.data.status = 'failed'
    assert.equal(mapPostCall(failed)!.outcome, 'failed')
  })

  it('maps call initiation failures and ignores audio', () => {
    const failure = mapPostCall({
      type: 'call_initiation_failure',
      event_timestamp: 1_800_000_000,
      data: { agent_id: 'agent_123', conversation_id: 'conv_fail', failure_reason: 'busy', metadata: { type: 'twilio', body: { To: SHOP_PHONE, From: '+15125550188', CallSid: 'CA9' } } },
    })!
    assert.equal(failure.outcome, 'missed')
    assert.equal(failure.called_number, SHOP_PHONE)
    assert.equal(failure.caller_phone, '+15125550188')
    assert.equal(mapPostCall({ type: 'post_call_audio', data: { conversation_id: 'x', full_audio: 'AAAA' } }), null)
    assert.equal(mapPostCall('nonsense'), null)
  })
})

describe('third parties', () => {
  let server: TestServer
  let fake: Upstream

  before(async () => {
    fake = await startUpstream()
    fake.routes.set('GET /v1/convai/conversation/get-signed-url', (r) =>
      r.headers['xi-api-key'] === 'xi-secret-key' ? { status: 200, body: { signed_url: 'wss://api.elevenlabs.io/v1/convai/conversation?agent_id=agent_123&conversation_signature=sig' } } : { status: 401 },
    )
    fake.routes.set('GET /v1/convai/agents/agent_123', () => ({ status: 200, body: { agent_id: 'agent_123', name: 'Jarvis Receptionist' } }))
    fake.routes.set('GET /v1/convai/phone-numbers', () => ({ status: 200, body: [{ phone_number: SHOP_PHONE, provider: 'twilio' }, { phone_number: '+15125550167', provider: 'twilio' }] }))
    fake.routes.set(`GET /2010-04-01/Accounts/${TWILIO_SID}.json`, () => ({ status: 200, body: { status: 'active' } }))
    fake.routes.set(`POST /2010-04-01/Accounts/${TWILIO_SID}/`, () => ({ status: 201, body: { sid: 'SM1' } }))
    fake.routes.set('GET /v1/users/me', () => ({ status: 200, body: { bot: { workspace_name: 'Barber HQ' } } }))
    server = await startServer({
      env: {
        ELEVENLABS_API_KEY: 'xi-secret-key',
        ELEVENLABS_AGENT_ID: 'agent_123',
        ELEVENLABS_API_URL: fake.url,
        TWILIO_ACCOUNT_SID: TWILIO_SID,
        TWILIO_AUTH_TOKEN: 'twilio-token',
        TWILIO_FROM_NUMBER: '+15125550000',
        TWILIO_API_URL: fake.url,
        NOTION_API_KEY: 'secret_notion',
        NOTION_API_URL: fake.url,
      },
    })
  })
  after(async () => {
    await server.stop()
    await fake.close()
    cleanup(server.dataDir, server.staticDir)
  })

  describe('voice', () => {
    it('passes back a signed link and keeps the key to itself', async () => {
      const res = await server.api('/app/voice/session', { method: 'POST' })
      assert.equal(res.status, 200)
      assert.deepEqual(res.body, { signed_url: 'wss://api.elevenlabs.io/v1/convai/conversation?agent_id=agent_123&conversation_signature=sig' })
      const request = fake.requests.find((r) => r.path.startsWith('/v1/convai/conversation/get-signed-url'))!
      assert.equal(request.path, '/v1/convai/conversation/get-signed-url?agent_id=agent_123')
      assert.equal(request.headers['xi-api-key'], 'xi-secret-key')
    })

    it('answers 502 upstream when ElevenLabs fails', async () => {
      const original = fake.routes.get('GET /v1/convai/conversation/get-signed-url')!
      fake.routes.set('GET /v1/convai/conversation/get-signed-url', () => ({ status: 500 }))
      const res = await server.api('/app/voice/session', { method: 'POST' })
      fake.routes.set('GET /v1/convai/conversation/get-signed-url', original)
      assert.equal(res.status, 502)
      assert.equal(res.body.error.code, 'upstream')
      assert.ok(!JSON.stringify(res.body).includes('xi-secret-key'))
    })
  })

  describe('connections', () => {
    it('checks each service for real', async () => {
      const res = await server.api('/app/connections')
      const [eleven, twilio, notion, jarvis] = res.body.connections
      assert.deepEqual([eleven.state, twilio.state, notion.state, jarvis.state], ['connected', 'connected', 'connected', 'connected'])
      assert.equal(eleven.detail, 'Agent “Jarvis Receptionist” reachable.')
      assert.match(twilio.detail, /Twilio account reachable/)
      assert.equal(notion.detail, 'Connected to the Notion workspace “Barber HQ”.')
      assert.ok(typeof eleven.latency_ms === 'number')
      const twilioCheck = fake.requests.find((r) => r.path === `/2010-04-01/Accounts/${TWILIO_SID}.json`)!
      assert.equal(twilioCheck.headers.authorization, `Basic ${Buffer.from(`${TWILIO_SID}:twilio-token`).toString('base64')}`)
      const notionCheck = fake.requests.find((r) => r.path === '/v1/users/me')!
      assert.equal(notionCheck.headers['notion-version'], '2022-06-28')
      assert.ok(!JSON.stringify(res.body).match(/xi-secret-key|twilio-token|secret_notion/))
    })

    it('keeps one slow or broken service from affecting the others', async () => {
      fake.routes.set('GET /v1/users/me', () => ({ status: 200, body: {}, delayMs: 2500 }))
      fake.routes.set('GET /v1/convai/agents/agent_123', () => ({ status: 401 }))
      const started = Date.now()
      const res = await server.api('/app/connections')
      assert.ok(Date.now() - started < 9000)
      const [eleven, twilio, notion, jarvis] = res.body.connections
      assert.equal(eleven.state, 'error')
      assert.equal(eleven.detail, 'ElevenLabs rejected the API key. Check ELEVENLABS_API_KEY.')
      assert.equal(twilio.state, 'connected')
      assert.equal(notion.state, 'error')
      assert.match(notion.detail, /didn’t answer within/)
      assert.equal(jarvis.state, 'connected')
      fake.routes.set('GET /v1/users/me', () => ({ status: 200, body: { bot: { workspace_name: 'Barber HQ' } } }))
      fake.routes.set('GET /v1/convai/agents/agent_123', () => ({ status: 200, body: { name: 'Jarvis Receptionist' } }))
    })

    it('infers Twilio from the ElevenLabs phone numbers when there are no Twilio keys', async () => {
      const other = await startServer({ env: { ELEVENLABS_API_KEY: 'xi-secret-key', ELEVENLABS_AGENT_ID: 'agent_123', ELEVENLABS_API_URL: fake.url } })
      try {
        const twilio = (await other.api('/app/connections')).body.connections[1]
        assert.equal(twilio.state, 'connected')
        assert.equal(twilio.detail, '2 Twilio numbers attached in ElevenLabs.')
      } finally {
        await other.stop()
        cleanup(other.dataDir, other.staticDir)
      }
    })
  })

  describe('ElevenLabs post-call webhook', () => {
    it('stores a finished call with transcript and summary, mapped to the shop by the called number', async () => {
      await events(server, [{ type: 'shop.upsert', data: { name: 'Fade House', phone: SHOP_PHONE } }])
      const res = await postElevenLabs(server, postCallBody())
      assert.equal(res.status, 200)
      assert.equal(res.body.ok, true)
      const call = (await server.api(`/app/calls/${res.body.id}`)).body.call
      const shop = (await server.api('/app/shops')).body.shops.find((s: any) => s.phone === SHOP_PHONE)
      assert.equal(call.shop_id, shop.id)
      assert.equal(call.external_id, 'conv_abc')
      assert.equal(call.outcome, 'booked')
      assert.equal(call.caller_name, 'Marcus Lee')
      assert.equal(call.transcript.length, 3)
      assert.equal(call.summary, 'The caller booked a fade for tomorrow at 10 AM.')

      // Sent again (a retry with a new signature): same call, not a second one.
      await sleep(1000)
      const again = await postElevenLabs(server, postCallBody())
      assert.equal(again.body.id, res.body.id)
    })

    it('treats an exact resend as already done', async () => {
      const body = postCallBody({ conversationId: 'conv_resend' })
      const header = signature(ELEVENLABS_SECRET, JSON.stringify(body), undefined, 'v0')
      assert.equal((await postElevenLabs(server, body, { header })).status, 200)
      const resend = await postElevenLabs(server, body, { header })
      assert.equal(resend.status, 200)
      assert.equal(resend.body.duplicate, true)
    })

    it('adds a shop for a number it hasn’t seen and raises a missed-call alert', async () => {
      const body = postCallBody({ conversationId: 'conv_new_line', agentNumber: '+15125550999', dataCollection: {}, transcript: [{ role: 'agent', message: 'Hello?', time_in_call_secs: 0 }] })
      body.data.conversation_initiation_client_data.dynamic_variables.system__called_number = '+15125550999'
      const res = await postElevenLabs(server, body)
      assert.equal(res.status, 200)
      const shop = (await server.api('/app/shops')).body.shops.find((s: any) => s.phone === '+15125550999')
      assert.equal(shop.name, 'Shop at (512) 555-0999')
      const call = (await server.api(`/app/calls/${res.body.id}`)).body.call
      assert.equal(call.outcome, 'missed')
      const alert = (await server.api('/app/alerts')).body.alerts.find((a: any) => a.call_id === res.body.id)
      assert.equal(alert.type, 'missed_call')
      assert.equal(alert.shop_id, shop.id)
    })

    it('refuses bad, stale and missing signatures; ignores audio', async () => {
      assert.equal((await postElevenLabs(server, postCallBody(), { secret: 'wrong' })).status, 401)
      assert.equal((await postElevenLabs(server, postCallBody(), { header: null })).status, 401)
      assert.equal((await postElevenLabs(server, postCallBody(), { t: Math.floor(Date.now() / 1000) - 31 * 60 })).status, 401)
      const v1 = await postElevenLabs(server, postCallBody(), { header: signature(ELEVENLABS_SECRET, JSON.stringify(postCallBody())) })
      assert.equal(v1.status, 401, 'ElevenLabs signs with v0')
      const audio = await postElevenLabs(server, { type: 'post_call_audio', data: { conversation_id: 'conv_abc', full_audio: 'AAAA' } })
      assert.equal(audio.status, 200)
      assert.equal(audio.body.ignored, true)
    })

    it('says so when no ElevenLabs webhook secret is set', async () => {
      const bare = await startServer({ env: { ELEVENLABS_WEBHOOK_SECRET: '' }, owner: false })
      try {
        assert.equal((await postElevenLabs(bare, postCallBody())).status, 503)
      } finally {
        await bare.stop()
        cleanup(bare.dataDir, bare.staticDir)
      }
    })
  })

  describe('alerts by text and call', () => {
    it('texts or calls the owner through Twilio when the channel says so', async () => {
      await server.api('/app/settings', {
        method: 'PATCH',
        body: { notify_phone: '+15125550100', quiet_hours_enabled: false, notification_prefs: { system: 'text', failed_call: 'call', task_done: 'in_app' } },
      })
      const before = fake.requests.length
      await events(server, [
        { type: 'alert.create', data: { type: 'system', title: 'Backup finished', body: 'All good' } },
        { type: 'alert.create', data: { type: 'failed_call', title: 'A call failed at <Fade House>' } },
        { type: 'alert.create', data: { type: 'task_done', title: 'Quiet one' } },
      ])
      for (let i = 0; i < 100 && fake.requests.length < before + 2; i++) await sleep(20)
      const sent = fake.requests.slice(before).filter((r) => r.method === 'POST')
      assert.equal(sent.length, 2, 'in_app alerts are not sent')
      const sms = sent.find((r) => r.path.endsWith('/Messages.json'))!
      const form = new URLSearchParams(sms.body)
      assert.equal(form.get('To'), '+15125550100')
      assert.equal(form.get('From'), '+15125550000')
      assert.equal(form.get('Body'), 'Jarvis: Backup finished. All good')
      assert.equal(sms.headers['content-type'], 'application/x-www-form-urlencoded')
      const call = sent.find((r) => r.path.endsWith('/Calls.json'))!
      const twiml = new URLSearchParams(call.body).get('Twiml')!
      assert.match(twiml, /^<Response><Say>This is Jarvis\. A call failed at &lt;Fade House&gt;<\/Say>/)
    })

    it('logs a Twilio failure without breaking the request', async () => {
      fake.routes.set(`POST /2010-04-01/Accounts/${TWILIO_SID}/`, () => ({ status: 500 }))
      const res = await events(server, [{ type: 'alert.create', data: { type: 'system', title: 'Still fine' } }])
      assert.equal(res.status, 200)
      assert.equal(res.body.results[0].notify.channel, 'text')
    })
  })
})
