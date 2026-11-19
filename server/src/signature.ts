/**
 * Signed webhooks: "t=<unix seconds>,<scheme>=<hex hmac_sha256(secret, "<t>.<raw body>")>".
 *
 * Jarvis's own hook uses scheme v1 (docs/backend.md); ElevenLabs uses v0.
 * The HMAC covers the exact bytes that arrived, the comparison is constant
 * time, timestamps outside the window are refused, and an exact signature
 * seen before (a replay) is refused too.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

export type Verdict = 'ok' | 'missing' | 'malformed' | 'stale' | 'mismatch' | 'replay'

export function sign(secret: string, t: number, body: Buffer | string): string {
  return createHmac('sha256', secret).update(`${t}.`).update(body).digest('hex')
}

function parse(header: string, scheme: string): { t: number; signatures: string[] } | null {
  if (header.length > 1000) return null
  let t: string | null = null
  const signatures: string[] = []
  for (const part of header.split(',').map((piece) => piece.trim())) {
    const eq = part.indexOf('=')
    if (eq <= 0) return null
    const key = part.slice(0, eq)
    const value = part.slice(eq + 1)
    if (key === 't') {
      if (t !== null) return null
      t = value
    } else if (key === scheme) {
      signatures.push(value)
    }
  }
  if (t === null || !/^\d{1,12}$/.test(t) || signatures.length === 0) return null
  if (signatures.some((value) => !/^[0-9a-fA-F]{64}$/.test(value))) return null
  return { t: Number(t), signatures: signatures.map((value) => value.toLowerCase()) }
}

/** Remembers signatures for as long as they could still be accepted. */
export class ReplayGuard {
  private seen = new Map<string, number>()

  check(signature: string, ttlMs: number): boolean {
    const now = Date.now()
    if (this.seen.size > 10_000) {
      for (const [key, until] of this.seen) if (until <= now) this.seen.delete(key)
    }
    const until = this.seen.get(signature)
    if (until !== undefined && until > now) return false
    this.seen.set(signature, now + ttlMs)
    return true
  }
}

export function verify(options: {
  secret: string
  header: string | undefined | string[]
  body: Buffer
  scheme: 'v1' | 'v0'
  toleranceSeconds: number
  guard: ReplayGuard
  nowSeconds?: number
}): Verdict {
  const header = Array.isArray(options.header) ? options.header[0] : options.header
  if (!header || header.trim() === '') return 'missing'
  const parsed = parse(header, options.scheme)
  if (!parsed) return 'malformed'
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000)
  if (Math.abs(now - parsed.t) > options.toleranceSeconds) return 'stale'
  const expected = Buffer.from(sign(options.secret, parsed.t, options.body), 'hex')
  const match = parsed.signatures.find((value) => timingSafeEqual(Buffer.from(value, 'hex'), expected))
  if (!match) return 'mismatch'
  if (!options.guard.check(`${options.scheme}:${parsed.t}:${match}`, options.toleranceSeconds * 2000)) return 'replay'
  return 'ok'
}
