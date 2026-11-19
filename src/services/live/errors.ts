/**
 * Turns everything Supabase can fail with into a `ServiceError`.
 *
 * This is the only place that knows PostgREST codes, Postgres SQLSTATEs,
 * auth error codes or edge-function replies. Each mapping keeps the original
 * error as `cause` and returns a sentence that is safe to put on screen. The
 * sentences never restate the action ("Couldn't load tasks"), because the
 * screen already says that above them.
 */
import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
  isAuthError,
  isAuthRetryableFetchError,
} from '@supabase/supabase-js'

import { ServiceError } from '@/services/errors'
import type { ServiceErrorCode } from '@/services/errors'

export const SAY = {
  unreachable: 'Couldn’t reach Jarvis. Check your connection and try again.',
  slow: 'Jarvis took too long to answer. Try again in a moment.',
  sessionEnded: 'Your session has ended. Sign in again.',
  notOwner: 'This account can’t do that. Sign in as the owner.',
  notSetUp:
    'The Jarvis database isn’t set up for this version of the app. Run the Supabase migrations, then try again.',
  rejected: 'Jarvis couldn’t accept that. Check what you entered and try again.',
  notFound: 'Couldn’t find that. It may have been deleted.',
  unknown: 'Something went wrong on Jarvis’s side. Try again in a moment.',
} as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** How browsers (and supabase-js, which prefixes the error name) word a request that never got an answer. */
const FETCH_FAILURE = /^(TypeError|FetchError|AbortError|TimeoutError)\b|failed to fetch|load failed|networkerror|network request failed/i

function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return typeof error === 'string' ? error : ''
}

function isTimeout(error: unknown): boolean {
  return isRecord(error) && (error.name === 'AbortError' || error.name === 'TimeoutError')
}

/** Anything that was thrown rather than returned: a ServiceError passes through untouched. */
export function unexpectedError(cause: unknown): ServiceError {
  if (cause instanceof ServiceError) return cause
  if (FETCH_FAILURE.test(describe(cause))) return new ServiceError('network', SAY.unreachable, { cause })
  return new ServiceError('unknown', SAY.unknown, { cause })
}

// ── Tables and RPCs (PostgREST) ────────────────────────────────────────────

/** The error object PostgREST answers with, reduced to what we read. */
export interface DbFailure {
  message?: string | null
  code?: string | null
  details?: string | null
  hint?: string | null
}

export interface ErrorCopy {
  /**
   * What to say when the row is not there. Giving it also turns a malformed
   * id (an old or mistyped link) into "not found" instead of "invalid".
   */
  notFound?: string
}

/** The token is missing, expired or not accepted. */
const SESSION_CODES = new Set(['PGRST301', 'PGRST302', 'PGRST303'])
/** A table, column or function the app expects is not in the database. */
const SCHEMA_CODES = new Set(['PGRST202', 'PGRST204', 'PGRST205', '42P01', '42703', '42883'])
const NO_ROW = 'PGRST116'
const MALFORMED_VALUE = '22P02'
const PERMISSION_DENIED = '42501'
const STATEMENT_TIMEOUT = '57014'

export function dbError(failure: DbFailure, status: number | undefined, copy: ErrorCopy = {}): ServiceError {
  const code = failure.code ?? ''
  const cause = { cause: failure }

  // supabase-js reports a request that never completed as status 0 with no code.
  if (status === 0 || (code === '' && FETCH_FAILURE.test(failure.message ?? ''))) {
    return new ServiceError('network', SAY.unreachable, cause)
  }
  if (code === NO_ROW || (code === MALFORMED_VALUE && copy.notFound !== undefined)) {
    return new ServiceError('not_found', copy.notFound ?? SAY.notFound, cause)
  }
  if (SESSION_CODES.has(code) || status === 401) {
    return new ServiceError('unauthorized', SAY.sessionEnded, cause)
  }
  if (code === PERMISSION_DENIED || status === 403) {
    // 403 means the token was fine but row-level security said no: signed
    // in, just not as the owner. Without a status we assume the session.
    return new ServiceError('unauthorized', status === 403 ? SAY.notOwner : SAY.sessionEnded, cause)
  }
  if (SCHEMA_CODES.has(code)) return new ServiceError('not_configured', SAY.notSetUp, cause)
  if (code === STATEMENT_TIMEOUT) return new ServiceError('network', SAY.slow, cause)
  // Class 22 is a value Postgres could not read, class 23 a broken constraint.
  if (code.startsWith('22') || code.startsWith('23')) return new ServiceError('invalid', SAY.rejected, cause)
  return new ServiceError('unknown', SAY.unknown, cause)
}

// ── Auth ───────────────────────────────────────────────────────────────────

export type AuthStep = 'password' | 'send_code' | 'verify_code' | 'sign_out'

export const WRONG_CODE = 'That code is wrong or has expired. Ask for a new one.'

const AUTH_FALLBACK: Record<AuthStep, [ServiceErrorCode, string]> = {
  password: ['unauthorized', 'Couldn’t sign you in. Check your email and password, then try again.'],
  send_code: ['invalid', 'Couldn’t send a code. Try again, or sign in with your password.'],
  verify_code: ['unauthorized', WRONG_CODE],
  sign_out: ['network', 'Couldn’t sign out. Check your connection and try again.'],
}

/** Server answers that mean "there is no account for that email". */
const NO_ACCOUNT_CODES = new Set(['otp_disabled', 'signup_disabled', 'user_not_found'])

/**
 * True when asking for a code failed only because the email has no account.
 * The caller treats that as success so the screen never confirms which
 * addresses exist.
 */
export function isUnknownEmail(error: unknown): boolean {
  return isAuthError(error) && typeof error.code === 'string' && NO_ACCOUNT_CODES.has(error.code)
}

export function authError(error: unknown, step: AuthStep): ServiceError {
  if (error instanceof ServiceError) return error
  const cause = { cause: error }

  if (isAuthRetryableFetchError(error) || FETCH_FAILURE.test(describe(error))) {
    return new ServiceError('network', SAY.unreachable, cause)
  }

  const code = isAuthError(error) ? error.code : undefined
  const status = isAuthError(error) ? error.status : undefined

  if (status === 429 || code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit') {
    return new ServiceError('invalid', 'Too many tries. Wait a minute, then try again.', cause)
  }
  if (step === 'verify_code' && (code === 'otp_expired' || code === 'invalid_credentials')) {
    return new ServiceError('unauthorized', WRONG_CODE, cause)
  }
  switch (code) {
    case 'invalid_credentials':
      return new ServiceError('unauthorized', 'That email and password don’t match.', cause)
    case 'email_address_invalid':
    case 'validation_failed':
      return new ServiceError('invalid', 'That doesn’t look like an email address.', cause)
    case 'email_not_confirmed':
      return new ServiceError(
        'unauthorized',
        'That email hasn’t been confirmed yet. Confirm the account in Supabase, then sign in.',
        cause,
      )
    case 'user_banned':
      return new ServiceError('unauthorized', 'This account can’t sign in.', cause)
    case 'email_address_not_authorized':
      return new ServiceError(
        'invalid',
        'Supabase’s built-in email can only send to your own team. Sign in with your password, or add your own email sender in Supabase.',
        cause,
      )
  }
  if (status !== undefined && status >= 500) {
    return new ServiceError('network', 'Supabase had a problem signing you in. Try again in a moment.', cause)
  }

  const [fallbackCode, message] = AUTH_FALLBACK[step]
  return new ServiceError(fallbackCode, message, cause)
}

// ── Edge functions ─────────────────────────────────────────────────────────

/** The codes our functions put in `{ error: { code, message } }`. */
const FUNCTION_CODES = new Map<string, ServiceErrorCode>([
  ['unauthorized', 'unauthorized'],
  ['forbidden', 'unauthorized'],
  ['invalid', 'invalid'],
  ['not_found', 'not_found'],
  ['not_configured', 'not_configured'],
  ['upstream', 'unknown'],
])

interface HttpAnswer {
  status: number
  clone(): { json(): Promise<unknown> }
}

function isHttpAnswer(value: unknown): value is HttpAnswer {
  return isRecord(value) && typeof value.status === 'number' && typeof value.clone === 'function'
}

interface Envelope {
  code: string | null
  message: string | null
}

/** Reads `{ error: { code, message } }` from a non-2xx reply; null when the reply is not one of ours. */
async function readEnvelope(answer: HttpAnswer): Promise<Envelope | null> {
  let body: unknown
  try {
    body = await answer.clone().json()
  } catch {
    return null
  }
  const error = isRecord(body) ? body.error : undefined
  if (typeof error === 'string' && error.trim() !== '') return { code: null, message: error.trim() }
  if (!isRecord(error)) return null
  return {
    code: typeof error.code === 'string' ? error.code : null,
    message: typeof error.message === 'string' && error.message.trim() !== '' ? error.message.trim() : null,
  }
}

function codeForStatus(status: number): ServiceErrorCode {
  if (status === 401 || status === 403) return 'unauthorized'
  if (status === 404) return 'not_found'
  if (status === 400 || status === 409 || status === 422) return 'invalid'
  return 'unknown'
}

function functionFallback(code: ServiceErrorCode, name: string): string {
  switch (code) {
    case 'unauthorized':
      return SAY.sessionEnded
    case 'invalid':
      return SAY.rejected
    case 'not_found':
      return SAY.notFound
    case 'not_configured':
      return `The ${name} function is missing a secret. Add it in Supabase, then try again.`
    default:
      return `The ${name} function failed. Try again in a moment.`
  }
}

/** Maps the `error` from `supabase.functions.invoke` for the function called `name`. */
export async function functionError(name: string, error: unknown): Promise<ServiceError> {
  if (error instanceof ServiceError) return error
  const cause = { cause: error }

  if (error instanceof FunctionsFetchError) {
    // The request never got an answer. In a browser this is also what a
    // function that was never deployed looks like, so the sentence says both.
    const message = isTimeout(error.context)
      ? `The ${name} function took too long to answer. Try again in a moment.`
      : `Couldn’t reach the ${name} function. Check your connection, and make sure the function is deployed.`
    return new ServiceError('network', message, cause)
  }
  if (error instanceof FunctionsRelayError) {
    return new ServiceError('network', `Supabase couldn’t run the ${name} function. Try again in a moment.`, cause)
  }
  if (error instanceof FunctionsHttpError && isHttpAnswer(error.context)) {
    const { status } = error.context
    const envelope = await readEnvelope(error.context)
    if (envelope === null) {
      // Not our reply shape, so the answer came from Supabase's gateway.
      if (status === 404) {
        return new ServiceError(
          'not_configured',
          `The ${name} function isn’t deployed yet. Deploy it to your Supabase project, then try again.`,
          cause,
        )
      }
      const code = status === 401 || status === 403 ? 'unauthorized' : 'unknown'
      return new ServiceError(code, functionFallback(code, name), cause)
    }
    const code = (envelope.code !== null ? FUNCTION_CODES.get(envelope.code) : undefined) ?? codeForStatus(status)
    return new ServiceError(code, envelope.message ?? functionFallback(code, name), cause)
  }
  return new ServiceError('unknown', functionFallback('unknown', name), cause)
}
