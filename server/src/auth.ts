/**
 * The one owner: password (scrypt), sign-in codes by email, and sessions.
 *
 * - Nothing reachable over HTTP creates an account. The owner is created by
 *   `npm run owner` (or OWNER_EMAIL + OWNER_PASSWORD on first start).
 * - Session tokens are 32 random bytes; only their SHA-256 is stored. They
 *   last 30 days and logout deletes them.
 * - Failures are rate limited per email and per IP address, and every
 *   refusal reads the same whether or not the email is the owner's.
 */
import { randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto'

import type { Db } from './db.ts'
import { SAY, tooMany, unauthorized } from './errors.ts'
import { newId, nowIso, safeEqual, sha256 } from './util.ts'

export const SESSION_DAYS = 30
export const CODE_MINUTES = 10
export const CODE_TRIES = 5

const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64 }

function scryptAsync(password: string, salt: Buffer, params = SCRYPT): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize('NFKC'),
      salt,
      params.keylen,
      { N: params.N, r: params.r, p: params.p, maxmem: 128 * params.N * params.r * 2 },
      (error, key) => (error ? reject(error) : resolve(key)),
    )
  })
}

/** "scrypt$N$r$p$<salt b64>$<hash b64>" */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scryptAsync(password, salt)
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$')
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, n, r, p, salt, hash] = parts
  const expected = Buffer.from(hash, 'base64')
  const key = await scryptAsync(password, Buffer.from(salt, 'base64'), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    keylen: expected.length,
  })
  return key.length === expected.length && timingSafeEqual(key, expected)
}

/** Checked against when the email isn't the owner's, so both answers take as long. */
let decoyHash: Promise<string> | null = null
const decoy = () => (decoyHash ??= hashPassword(randomBytes(16).toString('hex')))

// ── Rate limiting ──────────────────────────────────────────────────────────

/** Counts events per key in a sliding window. In memory: a restart forgets, which is fine for one owner. */
export class Limiter {
  private hits = new Map<string, number[]>()
  private limit: number
  private windowMs: number

  constructor(limit: number, windowMs: number) {
    this.limit = limit
    this.windowMs = windowMs
  }

  private recent(key: string): number[] {
    const cutoff = Date.now() - this.windowMs
    const list = (this.hits.get(key) ?? []).filter((at) => at > cutoff)
    if (list.length === 0) this.hits.delete(key)
    else this.hits.set(key, list)
    return list
  }

  blocked(key: string): boolean {
    return this.recent(key).length >= this.limit
  }

  hit(key: string): void {
    const list = this.recent(key)
    list.push(Date.now())
    this.hits.set(key, list)
  }

  reset(key: string): void {
    this.hits.delete(key)
  }

  prune(): void {
    for (const key of [...this.hits.keys()]) this.recent(key)
  }
}

export interface Owner {
  id: string
  email: string
}

export function createAuth(db: Db) {
  const limits = {
    loginEmail: new Limiter(5, 15 * 60_000),
    loginIp: new Limiter(5, 15 * 60_000),
    codeEmail: new Limiter(3, 60 * 60_000),
    codeIp: new Limiter(10, 60 * 60_000),
    verifyIp: new Limiter(10, 15 * 60_000),
  }
  const pruner = setInterval(() => Object.values(limits).forEach((limiter) => limiter.prune()), 10 * 60_000)
  pruner.unref()

  const ownerRow = () => db.prepare('SELECT id, email, password_hash FROM owner LIMIT 1').get() as
    | { id: string; email: string; password_hash: string }
    | undefined

  function owner(): Owner | null {
    const row = ownerRow()
    return row ? { id: row.id, email: row.email } : null
  }

  function isOwnerEmail(email: string): Owner | null {
    const row = ownerRow()
    return row && safeEqual(row.email.toLowerCase(), email.trim().toLowerCase()) ? { id: row.id, email: row.email } : null
  }

  /** Creates the owner, or changes the existing owner's email and password. There is only ever one. */
  async function setOwner(email: string, password: string): Promise<{ owner: Owner; created: boolean }> {
    const hash = await hashPassword(password)
    const existing = ownerRow()
    const at = nowIso()
    if (existing) {
      db.prepare('UPDATE owner SET email = ?, password_hash = ?, updated_at = ? WHERE id = ?').run(email, hash, at, existing.id)
      // A new password signs out every device.
      db.prepare('DELETE FROM sessions').run()
      return { owner: { id: existing.id, email }, created: false }
    }
    const id = newId()
    db.prepare('INSERT INTO owner (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, email, hash, at, at)
    return { owner: { id, email }, created: true }
  }

  function issue(owner: Owner): { token: string; user: Owner } {
    const token = randomBytes(32).toString('base64url')
    const now = Date.now()
    db.prepare('INSERT INTO sessions (token_hash, owner_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
      sha256(token),
      owner.id,
      new Date(now).toISOString(),
      new Date(now + SESSION_DAYS * 86_400_000).toISOString(),
    )
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date(now).toISOString())
    return { token, user: { id: owner.id, email: owner.email } }
  }

  /** The owner a bearer token belongs to, or null when it is missing, expired or revoked. */
  function session(token: string | null): { owner: Owner; tokenHash: string } | null {
    if (!token || token.length > 200) return null
    const tokenHash = sha256(token)
    const row = db
      .prepare(
        `SELECT o.id, o.email, s.expires_at FROM sessions s JOIN owner o ON o.id = s.owner_id
         WHERE s.token_hash = ?`,
      )
      .get(tokenHash) as { id: string; email: string; expires_at: string } | undefined
    if (!row || row.expires_at <= nowIso()) return null
    return { owner: { id: row.id, email: row.email }, tokenHash }
  }

  function isLive(tokenHash: string): boolean {
    const row = db.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').get(tokenHash) as { expires_at: string } | undefined
    return Boolean(row && row.expires_at > nowIso())
  }

  function revoke(token: string | null): string | null {
    if (!token) return null
    const tokenHash = sha256(token)
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash)
    return tokenHash
  }

  async function login(email: string, password: string, ip: string) {
    const key = email.trim().toLowerCase()
    if (limits.loginEmail.blocked(key) || limits.loginIp.blocked(ip)) throw tooMany()
    const row = ownerRow()
    const matches = row !== undefined && isOwnerEmail(email) !== null
    const ok = await verifyPassword(password, matches ? row.password_hash : await decoy())
    if (!matches || !ok) {
      limits.loginEmail.hit(key)
      limits.loginIp.hit(ip)
      throw unauthorized(SAY.wrongPassword)
    }
    limits.loginEmail.reset(key)
    return issue({ id: row.id, email: row.email })
  }

  /**
   * Makes a code for the owner's address and returns it (the caller emails
   * it). Returns null for any other address; the caller answers 204 either way.
   */
  function requestCode(email: string, ip: string): { to: string; code: string } | null {
    const key = email.trim().toLowerCase()
    if (limits.codeEmail.blocked(key) || limits.codeIp.blocked(ip)) throw tooMany()
    limits.codeEmail.hit(key)
    limits.codeIp.hit(ip)
    const found = isOwnerEmail(email)
    if (!found) return null
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    db.prepare(
      `INSERT INTO email_codes (email, code_hash, expires_at, attempts) VALUES (?, ?, ?, 0)
       ON CONFLICT (email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0`,
    ).run(found.email.toLowerCase(), sha256(code), new Date(Date.now() + CODE_MINUTES * 60_000).toISOString())
    return { to: found.email, code }
  }

  function verifyCode(email: string, code: string, ip: string) {
    if (limits.verifyIp.blocked(ip)) throw tooMany()
    const key = email.trim().toLowerCase()
    const row = db.prepare('SELECT code_hash, expires_at, attempts FROM email_codes WHERE email = ?').get(key) as
      | { code_hash: string; expires_at: string; attempts: number }
      | undefined
    const usable = row !== undefined && row.expires_at > nowIso() && row.attempts < CODE_TRIES
    const right = usable && /^\d{6}$/.test(code) && safeEqual(row.code_hash, sha256(code))
    const found = isOwnerEmail(email)
    if (!right || !found) {
      limits.verifyIp.hit(ip)
      if (row) {
        const attempts = row.attempts + 1
        // Five wrong tries and the code is dead.
        if (attempts >= CODE_TRIES) db.prepare('DELETE FROM email_codes WHERE email = ?').run(key)
        else db.prepare('UPDATE email_codes SET attempts = ? WHERE email = ?').run(attempts, key)
      }
      throw unauthorized(SAY.wrongCode)
    }
    db.prepare('DELETE FROM email_codes WHERE email = ?').run(key)
    return issue(found)
  }

  return { owner, setOwner, issue, session, isLive, revoke, login, requestCode, verifyCode, stop: () => clearInterval(pruner) }
}

export type Auth = ReturnType<typeof createAuth>
