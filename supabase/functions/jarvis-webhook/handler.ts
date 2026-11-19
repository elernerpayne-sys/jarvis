/**
 * jarvis-webhook
 *
 * The Jarvis backend pushes calls, appointments, task progress, approvals and
 * alerts here. It is not called with a user's session: the X-Jarvis-Signature
 * header is the only proof of who is calling, so nothing (not the body, not
 * the database) is touched until that signature checks out.
 *
 *   POST { events: [...] } | { type, data }  →  200 / 422 { "results": [...] }
 *   400 invalid · 401 unauthorized · 405 · 413 · 503 not_configured
 *
 * Order of work:
 *   1. POST only.
 *   2. A signing secret must be configured. Without one every request is
 *      refused (503); there is no "accept everything" mode.
 *   3. Read the body once, as raw bytes, stopping at 1 MB.
 *   4. Verify the signature over those exact bytes (5 minutes either way).
 *   5. Parse and shape-check. A broken envelope is a 400; a broken event is
 *      that event's { ok: false, error } entry.
 *   6. Send the valid events to jarvis_apply_events in one call, then put the
 *      results back in the sender's original order.
 *
 * Logs carry counts, event types and codes only: never the body, a phone
 * number, a transcript or the signature.
 */
import { type Db, dbErrorResponse } from '../_shared/db.ts'
import type { Env } from '../_shared/env.ts'
import {
  decodeUtf8,
  describeError,
  errorResponse,
  internalError,
  isRecord,
  jsonResponse,
  readBody,
} from '../_shared/http.ts'
import {
  parseSignatureHeader,
  TOLERANCE_SECONDS,
  toHex,
  verifySignature,
  webhookSecret,
} from './signature.ts'
import { parseEnvelope, validateEvent, type WebhookEvent } from './validate.ts'

const TAG = 'jarvis-webhook'
export const MAX_BODY_BYTES = 1_048_576
const BAD_SIGNATURE = 'The request signature is missing or not valid.'

export interface WebhookDeps {
  env: Env
  /** The service-role database. Called only after the signature has been verified. */
  db: () => Db
  now: () => Date
  /** Signatures already used; shared across requests in one worker. */
  replay?: ReplayGuard
}

export interface WebhookResult {
  index: number
  type: string | null
  ok: boolean
  id?: string
  error?: string
  notify?: unknown
}

/**
 * Best-effort replay protection: a signature that was accepted is refused if
 * it comes again within the tolerance window. It lives in one worker's
 * memory, so it narrows replays rather than ruling them out; the five-minute
 * window is the hard limit.
 */
export class ReplayGuard {
  #seen = new Map<string, number>()
  constructor(private readonly maxEntries = 10_000) {}

  /** True when the signature is new (and remembers it); false for a replay. */
  claim(signature: string, nowSeconds: number): boolean {
    for (const [key, expires] of this.#seen) {
      if (expires < nowSeconds) this.#seen.delete(key)
      else break // inserted in time order, so the rest are newer
    }
    if (this.#seen.has(signature)) return false
    if (this.#seen.size >= this.maxEntries) {
      const oldest = this.#seen.keys().next().value
      if (oldest !== undefined) this.#seen.delete(oldest)
    }
    this.#seen.set(signature, nowSeconds + 2 * TOLERANCE_SECONDS)
    return true
  }

  /** Forgets a signature, so a request that failed on our side can be retried. */
  release(signature: string): void {
    this.#seen.delete(signature)
  }
}

export async function handleWebhook(request: Request, deps: WebhookDeps): Promise<Response> {
  if (request.method !== 'POST') {
    await request.body?.cancel().catch(() => {})
    return errorResponse(405, 'invalid', 'Use POST for this endpoint.', { Allow: 'POST' })
  }

  const signingSecret = webhookSecret(deps.env)
  if (!signingSecret) {
    console.error(`${TAG}: no signing secret is configured; refusing the request`)
    await request.body?.cancel().catch(() => {})
    return errorResponse(
      503,
      'not_configured',
      'The webhook is not set up yet. Set JARVIS_WEBHOOK_SECRET (or JARVIS_API_KEY) in Supabase secrets.',
    )
  }

  const body = await readBody(request, MAX_BODY_BYTES)
  if (!body.ok) {
    if (body.reason === 'too_large') {
      console.error(`${TAG}: body over ${MAX_BODY_BYTES} bytes refused`)
      return errorResponse(413, 'invalid', 'The request body is larger than 1 MB.')
    }
    return errorResponse(400, 'invalid', 'The request body could not be read.')
  }

  const nowSeconds = Math.floor(deps.now().getTime() / 1000)
  const header = request.headers.get('X-Jarvis-Signature')
  const verdict = await verifySignature(signingSecret, header, body.bytes, nowSeconds)
  if (verdict !== 'ok') {
    console.error(`${TAG}: signature check failed (${verdict})`)
    return errorResponse(401, 'unauthorized', BAD_SIGNATURE)
  }
  // Keyed on the parsed values, so reordering the header or changing the hex
  // case cannot dress up a replay as a new request.
  const parsed = parseSignatureHeader(header ?? '')
  const signatureKey = parsed ? `${parsed.t}:${toHex(parsed.v1)}` : ''
  if (deps.replay && !deps.replay.claim(signatureKey, nowSeconds)) {
    console.error(`${TAG}: signature replayed`)
    return errorResponse(401, 'unauthorized', BAD_SIGNATURE)
  }

  try {
    const response = await apply(body.bytes, deps)
    if (response.status >= 500) deps.replay?.release(signatureKey)
    return response
  } catch (error) {
    console.error(`${TAG}: unhandled error`, describeError(error))
    deps.replay?.release(signatureKey)
    return internalError()
  }
}

async function apply(bytes: Uint8Array, deps: WebhookDeps): Promise<Response> {
  const text = decodeUtf8(bytes)
  if (text === null) return errorResponse(400, 'invalid', 'The body must be UTF-8 JSON.')
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return errorResponse(400, 'invalid', 'The body is not valid JSON.')
  }

  const envelope = parseEnvelope(value)
  if (!envelope.ok) return errorResponse(400, 'invalid', envelope.message)

  const results: (WebhookResult | null)[] = new Array(envelope.events.length).fill(null)
  const valid: WebhookEvent[] = []
  const validIndexes: number[] = []
  envelope.events.forEach((raw, index) => {
    const check = validateEvent(raw)
    if (check.ok) {
      valid.push(check.event)
      validIndexes.push(index)
    } else {
      results[index] = { index, type: check.type, ok: false, error: check.error }
    }
  })

  if (valid.length > 0) {
    const applied = await deps.db().rpc('jarvis_apply_events', { p_events: valid })
    if (!applied.ok) return dbErrorResponse(applied.error, TAG)
    const rows = Array.isArray(applied.data) ? applied.data : null
    if (!rows || rows.length !== valid.length) {
      console.error(`${TAG}: jarvis_apply_events returned an unexpected shape`)
      return internalError()
    }
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const index = validIndexes[i]
      if (!isRecord(row) || typeof row.ok !== 'boolean') {
        console.error(`${TAG}: jarvis_apply_events result ${i} has an unexpected shape`)
        return internalError()
      }
      results[index] = shapeResult(index, valid[i].type, row)
    }
  }

  const final = results as WebhookResult[]
  const failed = final.filter((result) => !result.ok)
  console.log(
    `${TAG}: ${final.length} event(s), ${failed.length} failed`,
    failed.length ? failed.map((result) => `${result.index}:${result.type ?? '?'}`).join(' ') : '',
  )
  return jsonResponse({ results: final }, failed.length === 0 ? 200 : 422)
}

/** Only the documented keys, with the sender's index. */
function shapeResult(index: number, type: string, row: Record<string, unknown>): WebhookResult {
  if (row.ok === true) {
    const result: WebhookResult = { index, type, ok: true }
    if (typeof row.id === 'string') result.id = row.id
    if (row.notify !== undefined) result.notify = row.notify
    return result
  }
  const error = typeof row.error === 'string' && row.error ? row.error : 'This event could not be applied.'
  return { index, type, ok: false, error }
}
