/**
 * JSON responses and request-body reading shared by every function.
 *
 * Failures always look like
 *   { "error": { "code": "not_configured", "message": "A sentence the app can show." } }
 * `message` is written for the owner. It never contains a secret, a token or
 * a raw reply from a third party.
 */

/**
 * The codes in docs/backend.md, plus `internal` for a fault on our side
 * (database unreachable, a bug). The app treats an unknown code as "unknown".
 */
export type ErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'invalid'
  | 'not_found'
  | 'not_configured'
  | 'upstream'
  | 'internal'

export interface ErrorBody {
  error: { code: ErrorCode; message: string }
}

const BASE_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'application/json; charset=utf-8',
  // Signed URLs, statuses and task rows are all "as of right now".
  'Cache-Control': 'no-store',
}

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...BASE_HEADERS, ...headers },
  })
}

export function errorResponse(
  status: number,
  code: ErrorCode,
  message: string,
  headers: Record<string, string> = {},
): Response {
  const body: ErrorBody = { error: { code, message } }
  return jsonResponse(body, status, headers)
}

export const INTERNAL_MESSAGE = 'Something went wrong on our side. Try again in a moment.'

export function internalError(): Response {
  return errorResponse(500, 'internal', INTERNAL_MESSAGE)
}

export function methodNotAllowed(allow = 'POST'): Response {
  return errorResponse(405, 'invalid', 'Use POST for this endpoint.', { Allow: allow })
}

/** A short, log-safe description of a thrown value. Never the stack, never a body. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 300)
  return String(error).slice(0, 300)
}

export type BodyRead =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: 'too_large' | 'unreadable' }

/**
 * Reads the request body once, as raw bytes, and stops as soon as it is
 * larger than `maxBytes`, so an oversized request is never held in memory.
 */
export async function readBody(request: Request, maxBytes: number): Promise<BodyRead> {
  const declared = request.headers.get('content-length')
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    await request.body?.cancel().catch(() => {})
    return { ok: false, reason: 'too_large' }
  }
  if (!request.body) return { ok: true, bytes: new Uint8Array(0) }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        return { ok: false, reason: 'too_large' }
      }
      chunks.push(value)
    }
  } catch {
    return { ok: false, reason: 'unreadable' }
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { ok: true, bytes }
}

/** Strict UTF-8 decoding: null when the bytes are not valid UTF-8. */
export function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

export type JsonRead = { ok: true; value: unknown } | { ok: false; response: Response }

/**
 * Reads a JSON request body of at most `maxBytes`. An empty body reads as
 * `undefined`, so "POST with an empty body" needs no special case.
 */
export async function readJson(request: Request, maxBytes: number): Promise<JsonRead> {
  const body = await readBody(request, maxBytes)
  if (!body.ok) {
    return body.reason === 'too_large'
      ? { ok: false, response: errorResponse(413, 'invalid', 'That request is too large.') }
      : { ok: false, response: errorResponse(400, 'invalid', 'The request could not be read.') }
  }
  if (body.bytes.byteLength === 0) return { ok: true, value: undefined }
  const text = decodeUtf8(body.bytes)
  if (text === null || text.trim() === '') {
    return text === null
      ? { ok: false, response: errorResponse(400, 'invalid', 'The request is not valid JSON.') }
      : { ok: true, value: undefined }
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown }
  } catch {
    return { ok: false, response: errorResponse(400, 'invalid', 'The request is not valid JSON.') }
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}
