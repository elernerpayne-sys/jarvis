import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { checkConnections, handleConnectionStatus } from '../connection-status/handler.ts'
import { bodyOf, captureLogs, envOf, fakeAuth, fakeFetch, json, post, type Route } from './helpers.ts'

const NOW = new Date('2026-11-19T12:00:00Z')
const SECRETS = {
  ELEVENLABS_API_KEY: 'xi-secret-1',
  ELEVENLABS_AGENT_ID: 'agent_1',
  TWILIO_ACCOUNT_SID: 'AC' + 'a'.repeat(32),
  TWILIO_AUTH_TOKEN: 'tw-secret-2',
  NOTION_API_KEY: 'ntn-secret-3',
  JARVIS_API_URL: 'https://jarvis.example.com',
  JARVIS_API_KEY: 'jv-secret-4',
}

async function check(values: Record<string, string>, routes: Record<string, Route>) {
  const out = fakeFetch(routes)
  const { result, logs } = await captureLogs(() =>
    checkConnections({ env: envOf(values), fetch: out.fetch, now: () => NOW, timeoutMs: 50 })
  )
  const text = JSON.stringify(result)
  for (const value of Object.values(SECRETS).filter((v) => v.includes('secret'))) {
    assertEquals(text.includes(value), false, `secret leaked: ${value}`)
    assertEquals(logs.includes(value), false, `secret logged: ${value}`)
  }
  return { list: result, out, by: Object.fromEntries(result.map((r) => [r.service, r])) }
}

const ALL_UP: Record<string, Route> = {
  'https://api.elevenlabs.io/v1/convai/agents/': () => json({ name: 'Front desk' }),
  'https://api.elevenlabs.io/v1/convai/phone-numbers': () => json([{ provider: 'twilio' }]),
  'https://api.twilio.com/': () => json({ status: 'active' }),
  'https://api.notion.com/': () => json({ bot: { workspace_name: 'Shops' } }),
  'https://jarvis.example.com/health': () => json({ ok: true }),
}

Deno.test('status: all connected, in order, with the right auth headers', async () => {
  const { list, out } = await check(SECRETS, ALL_UP)
  assertEquals(list.map((r) => r.service), ['elevenlabs', 'twilio', 'notion', 'jarvis'])
  assertEquals(list.map((r) => r.state), ['connected', 'connected', 'connected', 'connected'])
  assertStringIncludes(list[0].detail, 'Front desk')
  for (const r of list) {
    assertEquals(r.checked_at, NOW.toISOString())
    assertEquals(typeof r.latency_ms, 'number')
  }
  const header = (prefix: string, name: string) =>
    (out.calls.find((c) => c.url.startsWith(prefix))!.init.headers as Record<string, string>)[name]
  assertEquals(header('https://api.notion.com/', 'Notion-Version'), '2022-06-28')
  assertEquals(header('https://api.notion.com/', 'Authorization'), 'Bearer ntn-secret-3')
  assertEquals(header('https://jarvis.example.com/', 'Authorization'), 'Bearer jv-secret-4')
  assertEquals(header('https://api.twilio.com/', 'Authorization'), `Basic ${btoa(`${SECRETS.TWILIO_ACCOUNT_SID}:tw-secret-2`)}`)
})

Deno.test('status: nothing configured', async () => {
  const { list, out } = await check({}, {})
  assertEquals(list.map((r) => r.state), ['not_configured', 'not_configured', 'not_configured', 'not_configured'])
  assertEquals(list[2].detail, "Notion sync isn't set up yet.")
  assertEquals(list.every((r) => r.latency_ms === null), true)
  assertEquals(out.calls.length, 0)
})

Deno.test('status: elevenlabs key vs agent errors', async () => {
  const env = { ELEVENLABS_API_KEY: 'xi-secret-1', ELEVENLABS_AGENT_ID: 'agent_1' }
  const key = await check(env, { 'https://api.elevenlabs.io/': () => json({ detail: 'xi-secret-1' }, 401) })
  assertEquals(key.by.elevenlabs.state, 'error')
  assertStringIncludes(key.by.elevenlabs.detail, 'ELEVENLABS_API_KEY')
  const agent = await check(env, {
    'https://api.elevenlabs.io/v1/convai/agents/': () => json({}, 404),
    'https://api.elevenlabs.io/v1/convai/phone-numbers': () => json([]),
  })
  assertStringIncludes(agent.by.elevenlabs.detail, 'ELEVENLABS_AGENT_ID')
  assertEquals(agent.by.twilio.state, 'not_configured')
  assertEquals(agent.by.twilio.detail, 'No Twilio numbers are attached to ElevenLabs yet.')
})

Deno.test('status: twilio inferred from ElevenLabs numbers', async () => {
  const env = { ELEVENLABS_API_KEY: 'xi-secret-1', ELEVENLABS_AGENT_ID: 'agent_1' }
  const two = await check(env, {
    ...ALL_UP,
    'https://api.elevenlabs.io/v1/convai/phone-numbers': () =>
      json([{ provider: 'twilio' }, { provider: 'sip_trunk' }, { provider: 'twilio' }]),
  })
  assertEquals(two.by.twilio.state, 'connected')
  assertEquals(two.by.twilio.detail, '2 Twilio numbers attached in ElevenLabs.')
  const broken = await check(env, {
    ...ALL_UP,
    'https://api.elevenlabs.io/v1/convai/phone-numbers': () => json({}, 500),
  })
  assertEquals(broken.by.twilio.state, 'error')
  const noEl = await check({ TWILIO_ACCOUNT_SID: SECRETS.TWILIO_ACCOUNT_SID }, {})
  assertEquals(noEl.by.twilio.state, 'not_configured')
})

Deno.test('status: twilio with credentials, bad credentials and malformed SID', async () => {
  const env = { TWILIO_ACCOUNT_SID: SECRETS.TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN: 'tw-secret-2' }
  const bad = await check(env, { 'https://api.twilio.com/': () => json({ message: 'tw-secret-2' }, 401) })
  assertEquals(bad.by.twilio.state, 'error')
  assertStringIncludes(bad.by.twilio.detail, 'TWILIO_AUTH_TOKEN')
  const sid = await check({ ...env, TWILIO_ACCOUNT_SID: '../../evil' }, {})
  assertEquals(sid.by.twilio.state, 'error')
  assertEquals(sid.out.calls.length, 0)
})

Deno.test('status: one timeout or crash never affects the others', async () => {
  const { by } = await check(SECRETS, {
    ...ALL_UP,
    'https://api.notion.com/': () => 'hang',
    'https://jarvis.example.com/health': () => 'throw',
    'https://api.twilio.com/': () => json({}, 503),
  })
  assertEquals(by.elevenlabs.state, 'connected')
  assertEquals(by.notion.state, 'error')
  assertStringIncludes(by.notion.detail, "didn't answer")
  assertEquals(by.jarvis.state, 'error')
  assertEquals(by.twilio.state, 'error')
})

Deno.test('status: the checks run in parallel', async () => {
  const started = performance.now()
  const { list } = await check(SECRETS, {
    'https://api.elevenlabs.io/': () => 'hang',
    'https://api.twilio.com/': () => 'hang',
    'https://api.notion.com/': () => 'hang',
    'https://jarvis.example.com/': () => 'hang',
  })
  assertEquals(list.every((r) => r.state === 'error'), true)
  // Four 50 ms deadlines in parallel, not 200 ms in a row.
  assertEquals(performance.now() - started < 180, true)
})

Deno.test('status: jarvis 401 and invalid URL', async () => {
  const r = await check({ JARVIS_API_URL: 'https://jarvis.example.com', JARVIS_API_KEY: 'jv-secret-4' }, {
    'https://jarvis.example.com/': () => json({}, 401),
  })
  assertStringIncludes(r.by.jarvis.detail, 'JARVIS_API_KEY')
  const invalid = await check({ JARVIS_API_URL: 'javascript:alert(1)', JARVIS_API_KEY: 'jv-secret-4' }, {})
  assertEquals(invalid.by.jarvis.state, 'error')
  assertEquals(invalid.out.calls.length, 0)
})

Deno.test('status handler: 200 with four entries for the owner', async () => {
  const out = fakeFetch({})
  const res = await handleConnectionStatus(post(), { env: envOf({}), fetch: out.fetch, auth: fakeAuth(), now: () => NOW })
  assertEquals(res.status, 200)
  assertEquals(((await bodyOf(res)).connections as unknown[]).length, 4)
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*')
})
