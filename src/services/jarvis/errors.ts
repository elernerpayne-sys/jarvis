/**
 * Turns every way a request to the Jarvis backend can fail into a
 * `ServiceError` whose message is safe to show the owner.
 *
 * The backend answers failures with `{ "error": { "code", "message" } }`
 * (docs/app-api.md). When it does, its code decides and its message is shown.
 * When it does not (a proxy's error page, an endpoint that isn't built yet),
 * the HTTP status decides and one of the sentences below is shown.
 */
import { ServiceError } from '@/services/errors'
import type { ServiceErrorCode } from '@/services/errors'

export const SAY = {
  unreachable: 'Couldn’t reach Jarvis. Check your connection and try again.',
  slow: 'Jarvis took too long to answer. Try again in a moment.',
  sessionEnded: 'Your session has ended. Sign in again.',
  notOwner: 'This account can’t do that. Sign in as the owner.',
  notBuilt: 'Your Jarvis backend doesn’t support this yet.',
  rejected: 'Jarvis couldn’t accept that. Check what you entered and try again.',
  notFound: 'Couldn’t find that. It may have been deleted.',
  tooMany: 'Too many tries. Wait a minute, then try again.',
  unreadable: 'Jarvis sent back something the app couldn’t read. Try again in a moment.',
  unknown: 'Something went wrong on Jarvis’s side. Try again in a moment.',
} as const

/** The codes the backend may put in its error body, and what each means here. */
const BODY_CODES = new Map<string, ServiceErrorCode>([
  ['unauthorized', 'unauthorized'],
  ['forbidden', 'unauthorized'],
  ['invalid', 'invalid'],
  ['not_found', 'not_found'],
  ['not_configured', 'not_configured'],
  ['upstream', 'unknown'],
  ['internal', 'unknown'],
])

export interface ErrorBody {
  code: string | null
  message: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Reads `{ error: { code, message } }` (or `{ error: "message" }`); null when the body is not one. */
export function readErrorBody(body: unknown): ErrorBody | null {
  const error = isRecord(body) ? body.error : undefined
  if (typeof error === 'string') return error.trim() ? { code: null, message: error.trim() } : null
  if (!isRecord(error)) return null
  const message = typeof error.message === 'string' && error.message.trim() !== '' ? error.message.trim() : null
  return { code: typeof error.code === 'string' ? error.code : null, message }
}

function fallback(code: ServiceErrorCode): string {
  switch (code) {
    case 'unauthorized':
      return SAY.notOwner
    case 'invalid':
      return SAY.rejected
    case 'not_found':
      return SAY.notFound
    case 'not_configured':
      return SAY.notBuilt
    default:
      return SAY.unknown
  }
}

/**
 * A non-2xx answer. `body` is the parsed JSON, or undefined when there was
 * none. A 401 here always means the session ended (sign-in endpoints handle
 * their own 401 before calling this).
 */
export function httpError(status: number, body: unknown): ServiceError {
  const cause = { cause: { status, body } }
  const envelope = readErrorBody(body)

  if (status === 401) return new ServiceError('unauthorized', SAY.sessionEnded, cause)
  if (status === 429) return new ServiceError('invalid', envelope?.message ?? SAY.tooMany, cause)
  // A missing row says so with code "not_found". Any other 404 is an
  // endpoint the backend has not built yet.
  if (status === 404 && envelope?.code !== 'not_found') {
    return new ServiceError('not_configured', envelope?.message ?? SAY.notBuilt, cause)
  }
  if (status === 501) return new ServiceError('not_configured', envelope?.message ?? SAY.notBuilt, cause)

  const fromBody = envelope?.code ? BODY_CODES.get(envelope.code) : undefined
  const code = fromBody ?? codeForStatus(status)
  return new ServiceError(code, envelope?.message ?? fallback(code), cause)
}

function codeForStatus(status: number): ServiceErrorCode {
  if (status === 403) return 'unauthorized'
  if (status === 404) return 'not_found'
  if (status === 400 || status === 409 || status === 422) return 'invalid'
  return 'unknown'
}

/** A request that never got an answer. */
export function networkError(cause: unknown, timedOut: boolean): ServiceError {
  return new ServiceError('network', timedOut ? SAY.slow : SAY.unreachable, { cause })
}

/** A 2xx answer whose body is not what the contract says. */
export function unreadable(cause?: unknown): ServiceError {
  return new ServiceError('unknown', SAY.unreadable, { cause })
}
