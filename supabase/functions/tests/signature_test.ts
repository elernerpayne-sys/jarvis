import { assertEquals } from 'jsr:@std/assert@1'
import { parseSignatureHeader, sign, verifySignature, webhookSecret } from '../jarvis-webhook/signature.ts'
import { envOf } from './helpers.ts'

const SECRET = 'whsec_test'
const NOW = 1_800_000_000
const body = new TextEncoder().encode('{"events":[]}')

async function header(t = NOW, secret = SECRET, bytes = body) {
  return `t=${t},v1=${await sign(secret, t, bytes)}`
}

Deno.test('signature: valid, either order, uppercase hex', async () => {
  assertEquals(await verifySignature(SECRET, await header(), body, NOW), 'ok')
  const hex = await sign(SECRET, NOW, body)
  assertEquals(await verifySignature(SECRET, `v1=${hex},t=${NOW}`, body, NOW), 'ok')
  assertEquals(await verifySignature(SECRET, `t=${NOW}, v1=${hex.toUpperCase()}`, body, NOW), 'ok')
})

Deno.test('signature: matches node:crypto (the sender script)', async () => {
  const { createHmac } = await import('node:crypto')
  const text = '{"type":"shop.upsert","data":{}}'
  const expected = createHmac('sha256', SECRET).update(`${NOW}.${text}`).digest('hex')
  assertEquals(await sign(SECRET, NOW, new TextEncoder().encode(text)), expected)
})

Deno.test('signature: wrong secret, tampered body', async () => {
  assertEquals(await verifySignature(SECRET, await header(NOW, 'other'), body, NOW), 'mismatch')
  const tampered = new TextEncoder().encode('{"events":[ ]}')
  assertEquals(await verifySignature(SECRET, await header(), tampered, NOW), 'mismatch')
  // Same signature, different timestamp: t is part of what is signed.
  const hex = await sign(SECRET, NOW, body)
  assertEquals(await verifySignature(SECRET, `t=${NOW + 1},v1=${hex}`, body, NOW), 'mismatch')
})

Deno.test('signature: stale and future, boundary inclusive', async () => {
  assertEquals(await verifySignature(SECRET, await header(NOW - 300), body, NOW), 'ok')
  assertEquals(await verifySignature(SECRET, await header(NOW + 300), body, NOW), 'ok')
  assertEquals(await verifySignature(SECRET, await header(NOW - 301), body, NOW), 'stale')
  assertEquals(await verifySignature(SECRET, await header(NOW + 301), body, NOW), 'stale')
})

Deno.test('signature: missing and malformed headers', async () => {
  const hex = await sign(SECRET, NOW, body)
  assertEquals(await verifySignature(SECRET, null, body, NOW), 'missing')
  assertEquals(await verifySignature(SECRET, '  ', body, NOW), 'missing')
  for (const bad of [
    hex,
    `sha256=${hex}`,
    `t=${NOW}`,
    `v1=${hex}`,
    `t=${NOW},v1=${hex.slice(2)}`,
    `t=${NOW},v1=${hex}zz`,
    `t=abc,v1=${hex}`,
    `t=-5,v1=${hex}`,
    `t=${NOW},v1=${hex},v0=${hex}`,
    `t=${NOW},t=${NOW},v1=${hex}`,
    `t=${NOW};v1=${hex}`,
    `t=1e9,v1=${hex}`,
  ]) {
    assertEquals(parseSignatureHeader(bad), null, bad)
    assertEquals(await verifySignature(SECRET, bad, body, NOW), 'malformed', bad)
  }
})

Deno.test('webhookSecret: dedicated secret, fallback to API key, none', () => {
  assertEquals(webhookSecret(envOf({ JARVIS_WEBHOOK_SECRET: 'a', JARVIS_API_KEY: 'b' })), 'a')
  assertEquals(webhookSecret(envOf({ JARVIS_API_KEY: 'b' })), 'b')
  assertEquals(webhookSecret(envOf({ JARVIS_WEBHOOK_SECRET: '  ', JARVIS_API_KEY: 'b' })), 'b')
  assertEquals(webhookSecret(envOf({})), null)
})
