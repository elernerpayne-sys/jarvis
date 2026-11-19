/**
 * Verifies the X-Jarvis-Signature header on a push from the Jarvis backend.
 *
 *   X-Jarvis-Signature: t=<unix seconds>,v1=<hex hmac_sha256(secret, "<t>.<raw body>")>
 *
 * The HMAC is computed over the exact bytes that arrived, never over a
 * re-serialised body. Times more than five minutes away from now, in either
 * direction, are refused. The comparison touches every byte whatever the
 * input, so the time it takes says nothing about how close a guess was.
 */
import { type Env, secret } from '../_shared/env.ts'

export const TOLERANCE_SECONDS = 5 * 60

export type SignatureVerdict = 'ok' | 'missing' | 'malformed' | 'stale' | 'mismatch'

export interface ParsedSignature {
  t: number
  v1: Uint8Array
}

/** The signing secret: JARVIS_WEBHOOK_SECRET, else JARVIS_API_KEY, else null. */
export function webhookSecret(env: Env): string | null {
  return secret(env, 'JARVIS_WEBHOOK_SECRET') ?? secret(env, 'JARVIS_API_KEY')
}

/** Exactly `t=<1–12 digits>,v1=<64 hex>`, in either order, nothing else. */
export function parseSignatureHeader(header: string): ParsedSignature | null {
  if (header.length > 200) return null
  const parts = header.split(',').map((part) => part.trim())
  if (parts.length !== 2) return null
  let t: string | null = null
  let v1: string | null = null
  for (const part of parts) {
    const eq = part.indexOf('=')
    if (eq <= 0) return null
    const key = part.slice(0, eq)
    const value = part.slice(eq + 1)
    if (key === 't' && t === null) t = value
    else if (key === 'v1' && v1 === null) v1 = value
    else return null
  }
  if (t === null || v1 === null) return null
  if (!/^\d{1,12}$/.test(t) || !/^[0-9a-fA-F]{64}$/.test(v1)) return null
  return { t: Number(t), v1: hexToBytes(v1) }
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Constant-time for equal lengths (the only case that reaches it: both are 32 bytes). */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

/** hex(HMAC-SHA256(secret, "<t>." + body bytes)). Used by the tests and by the sender script's twin. */
export async function sign(secretValue: string, t: number, body: Uint8Array): Promise<string> {
  return toHex(await hmac(secretValue, t, body))
}

async function hmac(secretValue: string, t: number, body: Uint8Array): Promise<Uint8Array> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secretValue),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const prefix = encoder.encode(`${t}.`)
  const message = new Uint8Array(prefix.byteLength + body.byteLength)
  message.set(prefix, 0)
  message.set(body, prefix.byteLength)
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, message))
}

export async function verifySignature(
  secretValue: string,
  header: string | null,
  body: Uint8Array,
  nowSeconds: number,
): Promise<SignatureVerdict> {
  if (!header || header.trim() === '') return 'missing'
  const parsed = parseSignatureHeader(header)
  if (!parsed) return 'malformed'
  if (Math.abs(nowSeconds - parsed.t) > TOLERANCE_SECONDS) return 'stale'
  const expected = await hmac(secretValue, parsed.t, body)
  return timingSafeEqual(expected, parsed.v1) ? 'ok' : 'mismatch'
}
