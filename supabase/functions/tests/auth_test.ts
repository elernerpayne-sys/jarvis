import { assertEquals } from 'jsr:@std/assert@1'
import { bearerToken, requireOwner } from '../_shared/auth.ts'
import { handleCommand } from '../jarvis-command/handler.ts'
import { handleSignedUrl } from '../elevenlabs-signed-url/handler.ts'
import { handleConnectionStatus } from '../connection-status/handler.ts'
import {
  ANON_TOKEN,
  bodyOf,
  envOf,
  EXPIRED_TOKEN,
  fakeAuth,
  fakeDb,
  fakeFetch,
  OTHER_TOKEN,
  OWNER_ID,
  OWNER_TOKEN,
  post,
} from './helpers.ts'

const FULL_ENV = envOf({
  ELEVENLABS_API_KEY: 'xi-secret',
  ELEVENLABS_AGENT_ID: 'agent_1',
  JARVIS_API_URL: 'https://jarvis.example.com',
  JARVIS_API_KEY: 'jv-secret',
})

Deno.test('bearerToken accepts only a JWT-shaped bearer token', () => {
  const req = (h?: string) => new Request('https://x', { headers: h ? { Authorization: h } : {} })
  assertEquals(bearerToken(req()), null)
  assertEquals(bearerToken(req('Basic abc')), null)
  assertEquals(bearerToken(req('Bearer sb_secret_abcdef')), null)
  assertEquals(bearerToken(req('Bearer a.b.c d')), null)
  assertEquals(bearerToken(req('bearer a.b.c')), 'a.b.c')
})

Deno.test('requireOwner: no token, bad token, anon key, non-owner, owner', async () => {
  const auth = fakeAuth()
  const status = async (token: string | null) => {
    const check = await requireOwner(post(undefined, token), auth)
    return check.ok ? 200 : check.response.status
  }
  assertEquals(await status(null), 401)
  assertEquals(await status(EXPIRED_TOKEN), 401)
  assertEquals(await status(ANON_TOKEN), 401)
  assertEquals(await status(OTHER_TOKEN), 403)
  assertEquals(await status(OWNER_TOKEN), 200)
  const ok = await requireOwner(post(undefined, OWNER_TOKEN), auth)
  assertEquals(ok.ok && ok.owner.userId, OWNER_ID)
})

Deno.test('requireOwner: settings unreadable is a 500, a 401 from the database is 401', async () => {
  const base = fakeAuth()
  const failing = { ...base, readOwnerId: () => Promise.resolve({ kind: 'failed' as const, reason: 'boom' }) }
  const check = await requireOwner(post(), failing)
  assertEquals(check.ok ? 200 : check.response.status, 500)
  const refused = { ...base, readOwnerId: () => Promise.resolve({ kind: 'unauthorized' as const }) }
  const check2 = await requireOwner(post(), refused)
  assertEquals(check2.ok ? 200 : check2.response.status, 401)
})

Deno.test('a user id in the body never makes a non-owner the owner', async () => {
  const db = fakeDb()
  const out = fakeFetch({})
  const res = await handleCommand(
    post({ action: 'cancel_task', task_id: OWNER_ID, user_id: OWNER_ID, owner_id: OWNER_ID }, OTHER_TOKEN),
    { env: FULL_ENV, fetch: out.fetch, auth: fakeAuth(), db: db.db },
  )
  assertEquals(res.status, 403)
  assertEquals(db.opened, 0)
  assertEquals(out.calls.length, 0)
})

Deno.test('no owner function opens the service role, reads a secret or calls out without the owner', async () => {
  for (const token of [null, EXPIRED_TOKEN, ANON_TOKEN, OTHER_TOKEN]) {
    const db = fakeDb()
    const out = fakeFetch({})
    const envReads: string[] = []
    const env = (name: string) => {
      envReads.push(name)
      return FULL_ENV(name)
    }
    const deps = { env, fetch: out.fetch, auth: fakeAuth(), db: db.db, now: () => new Date() }
    const responses = [
      await handleCommand(post({ action: 'create_task', repo: 'a/b', instructions: 'x' }, token), deps),
      await handleSignedUrl(post(undefined, token), deps),
      await handleConnectionStatus(post(undefined, token), deps),
    ]
    for (const res of responses) {
      const body = await bodyOf(res)
      assertEquals([401, 403].includes(res.status), true)
      assertEquals(typeof (body.error as { code: string }).code, 'string')
      assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*')
    }
    assertEquals(db.opened, 0)
    assertEquals(out.calls.length, 0)
    assertEquals(envReads, [])
  }
})

Deno.test('CORS: preflight answered before auth, on all three functions', async () => {
  const auth = fakeAuth()
  const calls: string[] = []
  const deps = { env: FULL_ENV, fetch: fakeFetch({}).fetch, auth: fakeAuth(calls), db: fakeDb().db, now: () => new Date() }
  for (const handler of [handleCommand, handleSignedUrl, handleConnectionStatus]) {
    const res = await handler(new Request('https://x', { method: 'OPTIONS' }), deps)
    assertEquals(res.status, 204)
    assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*')
    assertEquals(res.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS')
    assertEquals((res.headers.get('Access-Control-Allow-Headers') ?? '').toLowerCase().includes('authorization'), true)
  }
  assertEquals(calls, [])
  void auth
})

Deno.test('non-POST is 405 with CORS', async () => {
  const deps = { env: FULL_ENV, fetch: fakeFetch({}).fetch, auth: fakeAuth(), db: fakeDb().db, now: () => new Date() }
  const res = await handleSignedUrl(post(undefined, OWNER_TOKEN, 'GET'), deps)
  assertEquals(res.status, 405)
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*')
})

Deno.test('a thrown error becomes a generic 500 with CORS', async () => {
  const auth = { ...fakeAuth(), verifyToken: () => Promise.reject(new Error('auth down')) }
  const deps = { env: FULL_ENV, fetch: fakeFetch({}).fetch, auth, db: fakeDb().db, now: () => new Date() }
  const res = await handleSignedUrl(post(), deps)
  assertEquals(res.status, 500)
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*')
  assertEquals(((await bodyOf(res)).error as { code: string }).code, 'internal')
})
