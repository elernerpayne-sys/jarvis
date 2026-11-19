import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { hashPassword, verifyPassword } from '../src/auth.ts'
import type { TestServer, Upstream } from './helpers.ts'
import { cleanup, OWNER, startServer, startUpstream } from './helpers.ts'

describe('passwords', () => {
  it('hashes with scrypt and verifies only the right password', async () => {
    const hash = await hashPassword('a long secret')
    assert.match(hash, /^scrypt\$32768\$8\$1\$/)
    assert.equal(await verifyPassword('a long secret', hash), true)
    assert.equal(await verifyPassword('a long secreT', hash), false)
    assert.equal(await verifyPassword('anything', 'garbage'), false)
  })
})

describe('sign-in', () => {
  let server: TestServer
  let mail: Upstream

  before(async () => {
    mail = await startUpstream()
    mail.routes.set('POST /emails', () => ({ status: 200, body: { id: 'email-1' } }))
    server = await startServer({ env: { RESEND_API_KEY: 're_test', MAIL_FROM: 'Jarvis <jarvis@example.com>', RESEND_API_URL: mail.url } })
  })
  after(async () => {
    await server.stop()
    await mail.close()
    cleanup(server.dataDir, server.staticDir)
  })

  it('logs in with the right email (any case) and password', async () => {
    const res = await server.api('/app/auth/login', { body: { email: 'Owner@Example.com', password: OWNER.password }, token: null })
    assert.equal(res.status, 200)
    assert.equal(typeof res.body.token, 'string')
    assert.ok(res.body.token.length >= 43)
    assert.equal(res.body.user.email, OWNER.email)
    assert.equal(typeof res.body.user.id, 'string')
  })

  it('refuses a wrong password or unknown email with the same answer', async () => {
    const wrong = await server.api('/app/auth/login', { body: { email: OWNER.email, password: 'nope nope nope' }, token: null })
    const unknown = await server.api('/app/auth/login', { body: { email: 'someone@example.com', password: OWNER.password }, token: null })
    assert.equal(wrong.status, 401)
    assert.deepEqual(wrong.body, { error: { code: 'unauthorized', message: 'That email and password don’t match.' } })
    assert.deepEqual(unknown.body, wrong.body)
    const empty = await server.api('/app/auth/login', { body: { email: '', password: '' }, token: null })
    assert.equal(empty.status, 400)
    assert.equal(empty.body.error.code, 'invalid')
  })

  it('stores only a hash of the session token', async () => {
    const rows = server.sql('SELECT token_hash FROM sessions') as { token_hash: string }[]
    assert.ok(rows.length > 0)
    assert.ok(rows.every((row) => row.token_hash !== server.token && /^[0-9a-f]{64}$/.test(row.token_hash)))
  })

  it('me answers who the token belongs to; garbage, missing and expired tokens get 401', async () => {
    const me = await server.api('/app/auth/me')
    assert.equal(me.status, 200)
    assert.equal(me.body.user.email, OWNER.email)

    for (const token of [null, 'garbage', 'x'.repeat(500)]) {
      const res = await server.api('/app/auth/me', { token })
      assert.equal(res.status, 401)
      assert.equal(res.body.error.code, 'unauthorized')
    }
    const brief = await server.api('/app/brief', { token: null })
    assert.equal(brief.status, 401)

    const login = await server.api('/app/auth/login', { body: OWNER, token: null })
    const token = login.body.token as string
    server.sql("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE created_at = (SELECT max(created_at) FROM sessions)")
    assert.equal((await server.api('/app/auth/me', { token })).status, 401)
  })

  it('sessions last 30 days', async () => {
    const rows = server.sql("SELECT created_at, expires_at FROM sessions WHERE expires_at > '2026' ORDER BY created_at DESC LIMIT 1") as { created_at: string; expires_at: string }[]
    const days = (Date.parse(rows[0].expires_at) - Date.parse(rows[0].created_at)) / 86_400_000
    assert.equal(Math.round(days), 30)
  })

  it('logout revokes the token and answers 204 even without one', async () => {
    const login = await server.api('/app/auth/login', { body: OWNER, token: null })
    const token = login.body.token as string
    assert.equal((await server.api('/app/auth/me', { token })).status, 200)
    const out = await server.api('/app/auth/logout', { method: 'POST', token })
    assert.equal(out.status, 204)
    assert.equal((await server.api('/app/auth/me', { token })).status, 401)
    assert.equal((await server.api('/app/auth/logout', { method: 'POST', token: null })).status, 204)
    assert.equal((await server.api('/app/auth/logout', { method: 'POST', token: 'garbage' })).status, 204)
  })

  it('emails a code only to the owner, answers 204 for anyone, and the code works once', async () => {
    const before = mail.requests.length
    const other = await server.api('/app/auth/code', { body: { email: 'stranger@example.com' }, token: null })
    assert.equal(other.status, 204)
    const res = await server.api('/app/auth/code', { body: { email: OWNER.email }, token: null })
    assert.equal(res.status, 204)
    // The email goes out in the background.
    for (let i = 0; i < 50 && mail.requests.length === before; i++) await new Promise((r) => setTimeout(r, 20))
    assert.equal(mail.requests.length, before + 1, 'exactly one email, to the owner')
    const sent = JSON.parse(mail.requests.at(-1)!.body)
    assert.deepEqual(sent.to, [OWNER.email])
    assert.equal(mail.requests.at(-1)!.headers.authorization, 'Bearer re_test')
    const code = /(\d{3}) (\d{3})/.exec(sent.text)!.slice(1).join('')

    const wrong = await server.api('/app/auth/verify', { body: { email: OWNER.email, code: '000000' === code ? '111111' : '000000' }, token: null })
    assert.equal(wrong.status, 401)
    assert.equal(wrong.body.error.message, 'That code is wrong or has expired. Ask for a new one.')

    const ok = await server.api('/app/auth/verify', { body: { email: OWNER.email, code: `${code.slice(0, 3)} ${code.slice(3)}` }, token: null })
    assert.equal(ok.status, 200)
    assert.equal(typeof ok.body.token, 'string')
    const again = await server.api('/app/auth/verify', { body: { email: OWNER.email, code }, token: null })
    assert.equal(again.status, 401, 'a code works for one sign-in')
  })

  it('a code dies after five wrong tries', async () => {
    const count = mail.requests.length
    await server.api('/app/auth/code', { body: { email: OWNER.email }, token: null })
    for (let i = 0; i < 50 && mail.requests.length === count; i++) await new Promise((r) => setTimeout(r, 20))
    const code = /(\d{3}) (\d{3})/.exec(JSON.parse(mail.requests.at(-1)!.body).text)!.slice(1).join('')
    const wrongCode = code === '123456' ? '654321' : '123456'
    for (let i = 0; i < 5; i++) {
      assert.equal((await server.api('/app/auth/verify', { body: { email: OWNER.email, code: wrongCode }, token: null })).status, 401)
    }
    const dead = await server.api('/app/auth/verify', { body: { email: OWNER.email, code }, token: null })
    assert.equal(dead.status, 401)
  })

  it('limits code emails to 3 per hour per address', async () => {
    const email = 'limit-me@example.com'
    for (let i = 0; i < 3; i++) assert.equal((await server.api('/app/auth/code', { body: { email }, token: null })).status, 204)
    const limited = await server.api('/app/auth/code', { body: { email }, token: null })
    assert.equal(limited.status, 429)
    assert.equal(limited.body.error.code, 'invalid')
  })
})

describe('sign-in limits and missing email setup', () => {
  let server: TestServer
  before(async () => {
    server = await startServer()
  })
  after(async () => {
    await server.stop()
    cleanup(server.dataDir, server.staticDir)
  })

  it('answers not_configured for codes when Resend is not set up', async () => {
    const res = await server.api('/app/auth/code', { body: { email: OWNER.email }, token: null })
    assert.equal(res.status, 503)
    assert.equal(res.body.error.code, 'not_configured')
    assert.match(res.body.error.message, /Sign in with your password/)
  })

  it('blocks login after 5 failures in 15 minutes, even with the right password', async () => {
    for (let i = 0; i < 5; i++) {
      assert.equal((await server.api('/app/auth/login', { body: { email: OWNER.email, password: `wrong ${i} password` }, token: null })).status, 401)
    }
    const blocked = await server.api('/app/auth/login', { body: OWNER, token: null })
    assert.equal(blocked.status, 429)
    assert.deepEqual(blocked.body, { error: { code: 'invalid', message: 'Too many tries. Wait a minute, then try again.' } })
    // The IP is blocked too, whatever email is tried.
    assert.equal((await server.api('/app/auth/login', { body: { email: 'x@example.com', password: 'whatever pass' }, token: null })).status, 429)
    // Existing sessions keep working.
    assert.equal((await server.api('/app/auth/me')).status, 200)
  })
})
