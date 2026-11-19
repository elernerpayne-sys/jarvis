import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { handleSignedUrl } from '../elevenlabs-signed-url/handler.ts'
import { bodyOf, captureLogs, envOf, fakeAuth, fakeFetch, json, post, type Route } from './helpers.ts'

const KEY = 'xi-very-secret-key'
const ENV = envOf({ ELEVENLABS_API_KEY: KEY, ELEVENLABS_AGENT_ID: 'agent_abc' })
const SIGNED = 'wss://api.elevenlabs.io/v1/convai/conversation?agent_id=agent_abc&conversation_signature=sig'

function run(route: Route, env = ENV) {
  const out = fakeFetch({ 'https://api.elevenlabs.io/': route })
  return captureLogs(async () => {
    const res = await handleSignedUrl(post(), { env, fetch: out.fetch, auth: fakeAuth(), timeoutMs: 50 })
    return { res, body: await bodyOf(res), out }
  })
}

Deno.test('signed url: happy path, key only in the header, never cached', async () => {
  const { result: { res, body, out }, logs } = await run(() => json({ signed_url: SIGNED }))
  assertEquals(res.status, 200)
  assertEquals(body, { signed_url: SIGNED })
  assertEquals(res.headers.get('Cache-Control'), 'no-store')
  assertEquals(out.calls[0].url, 'https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=agent_abc')
  assertEquals((out.calls[0].init.headers as Record<string, string>)['xi-api-key'], KEY)
  assertEquals(logs.includes(KEY), false)
})

Deno.test('signed url: missing secrets are 503 naming each one', async () => {
  for (const [env, names] of [
    [envOf({}), ['ELEVENLABS_API_KEY', 'ELEVENLABS_AGENT_ID']],
    [envOf({ ELEVENLABS_API_KEY: KEY }), ['ELEVENLABS_AGENT_ID']],
    [envOf({ ELEVENLABS_AGENT_ID: 'a', ELEVENLABS_API_KEY: '  ' }), ['ELEVENLABS_API_KEY']],
  ] as const) {
    const { result: { res, body, out } } = await run(() => json({}), env)
    assertEquals(res.status, 503)
    const error = body.error as { code: string; message: string }
    assertEquals(error.code, 'not_configured')
    for (const name of names) assertStringIncludes(error.message, name)
    assertEquals(out.calls.length, 0)
  }
})

Deno.test('signed url: upstream failures are 502 with a helpful sentence and no raw body', async () => {
  const cases: [Route, string][] = [
    [() => json({ detail: `bad key ${KEY}` }, 401), 'ELEVENLABS_API_KEY'],
    [() => json({ detail: 'nope' }, 404), 'ELEVENLABS_AGENT_ID'],
    [() => json({ detail: 'x' }, 422), 'ELEVENLABS_AGENT_ID'],
    [() => json({}, 500), 'trouble'],
    [() => json({}, 429), 'limiting'],
    [() => 'hang', "didn't answer"],
    [() => 'throw', "couldn't be reached"],
    [() => json({ signed_url: 'https://evil.example.com' }), "didn't send a link"],
    [() => new Response('not json'), "didn't send a link"],
  ]
  for (const [route, phrase] of cases) {
    const { result: { res, body }, logs } = await run(route)
    assertEquals(res.status, 502)
    const error = body.error as { code: string; message: string }
    assertEquals(error.code, 'upstream')
    assertStringIncludes(error.message, phrase)
    assertEquals(JSON.stringify(body).includes(KEY), false)
    assertEquals(JSON.stringify(body).includes('detail'), false)
    assertEquals(logs.includes(KEY), false)
  }
})
