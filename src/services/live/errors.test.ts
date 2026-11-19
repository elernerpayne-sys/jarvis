import {
  AuthApiError,
  AuthRetryableFetchError,
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import { ServiceError } from '@/services/errors'

import { authError, dbError, functionError, isUnknownEmail, unexpectedError } from './errors'

const UNREACHABLE = 'Couldn’t reach Jarvis. Check your connection and try again.'
const SESSION_ENDED = 'Your session has ended. Sign in again.'

function reply(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('dbError', () => {
  it('reads a request that never completed as a connection problem', () => {
    const failure = { message: 'TypeError: Failed to fetch', code: '', details: '', hint: '' }
    const error = dbError(failure, 0)

    expect(error).toBeInstanceOf(ServiceError)
    expect(error).toMatchObject({ code: 'network', message: UNREACHABLE })
    expect(error.cause).toBe(failure)
  })

  it('reads a request that timed out as a connection problem even without a status', () => {
    expect(dbError({ message: 'AbortError: The operation was aborted.', code: '' }, undefined)).toMatchObject({
      code: 'network',
      message: UNREACHABLE,
    })
  })

  it('reads "no rows" as not found, with the sentence the caller chose', () => {
    const failure = { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }

    expect(dbError(failure, 406, { notFound: 'Couldn’t find that task.' })).toMatchObject({
      code: 'not_found',
      message: 'Couldn’t find that task.',
    })
    expect(dbError(failure, 406)).toMatchObject({ code: 'not_found', message: 'Couldn’t find that. It may have been deleted.' })
  })

  it('treats an id that is not an id as not found when a row was being looked up', () => {
    const failure = { code: '22P02', message: 'invalid input syntax for type uuid: "nope"' }

    expect(dbError(failure, 400, { notFound: 'Couldn’t find that call.' })).toMatchObject({
      code: 'not_found',
      message: 'Couldn’t find that call.',
    })
    expect(dbError(failure, 400)).toMatchObject({ code: 'invalid' })
  })

  it.each([
    ['an expired token', { code: 'PGRST301', message: 'JWT expired' }, 401],
    ['a rejected token', { code: 'PGRST303', message: 'JWT expired' }, 401],
    ['no permission on the table', { code: '42501', message: 'permission denied for table tasks' }, 401],
    ['no permission and no status', { code: '42501', message: 'permission denied for table tasks' }, undefined],
  ])('asks the owner to sign in again after %s', (_what, failure, status) => {
    expect(dbError(failure, status)).toMatchObject({ code: 'unauthorized', message: SESSION_ENDED })
  })

  it('tells a signed-in account that is not the owner so', () => {
    const failure = { code: '42501', message: 'new row violates row-level security policy for table "decisions"' }

    expect(dbError(failure, 403)).toMatchObject({
      code: 'unauthorized',
      message: 'This account can’t do that. Sign in as the owner.',
    })
  })

  it.each([
    ['a missing function', 'PGRST202'],
    ['a missing table', 'PGRST205'],
    ['a missing table in Postgres', '42P01'],
    ['a missing column', '42703'],
  ])('points at the migrations for %s', (_what, code) => {
    expect(dbError({ code, message: 'not in the schema cache' }, 404)).toMatchObject({
      code: 'not_configured',
      message:
        'The Jarvis database isn’t set up for this version of the app. Run the Supabase migrations, then try again.',
    })
  })

  it.each([
    ['a broken constraint', '23514'],
    ['a duplicate', '23505'],
    ['a value that is too long', '22001'],
  ])('reads %s as something the owner can correct', (_what, code) => {
    expect(dbError({ code, message: 'violates check constraint' }, 400)).toMatchObject({
      code: 'invalid',
      message: 'Jarvis couldn’t accept that. Check what you entered and try again.',
    })
  })

  it('reads a statement timeout as Jarvis being slow', () => {
    expect(dbError({ code: '57014', message: 'canceling statement due to statement timeout' }, 500)).toMatchObject({
      code: 'network',
      message: 'Jarvis took too long to answer. Try again in a moment.',
    })
  })

  it('never shows a raw database message', () => {
    const error = dbError({ code: 'XX000', message: 'internal error: relation "pg_temp_3.x" lost' }, 500)

    expect(error).toMatchObject({
      code: 'unknown',
      message: 'Something went wrong on Jarvis’s side. Try again in a moment.',
    })
  })
})

describe('unexpectedError', () => {
  it('passes a ServiceError through untouched', () => {
    const original = new ServiceError('not_configured', 'Supabase isn’t connected yet.')

    expect(unexpectedError(original)).toBe(original)
  })

  it('reads a thrown fetch failure as a connection problem', () => {
    const cause = new TypeError('Failed to fetch')

    expect(unexpectedError(cause)).toMatchObject({ code: 'network', message: UNREACHABLE, cause })
  })

  it('reads anything else as unknown, keeping the cause', () => {
    const cause = new RangeError('Maximum call stack size exceeded')

    expect(unexpectedError(cause)).toMatchObject({ code: 'unknown', cause })
  })
})

describe('authError', () => {
  it('does not say which half of a wrong sign-in was wrong', () => {
    const cause = new AuthApiError('Invalid login credentials', 400, 'invalid_credentials')
    const error = authError(cause, 'password')

    expect(error).toBeInstanceOf(ServiceError)
    expect(error).toMatchObject({ code: 'unauthorized', message: 'That email and password don’t match.', cause })
  })

  it.each(['otp_expired', 'invalid_credentials'])('reads %s while checking a code as a wrong or expired code', (code) => {
    expect(authError(new AuthApiError('Token has expired or is invalid', 403, code), 'verify_code')).toMatchObject({
      code: 'unauthorized',
      message: 'That code is wrong or has expired. Ask for a new one.',
    })
  })

  it('reads a failed request as a connection problem', () => {
    expect(authError(new AuthRetryableFetchError('Failed to fetch', 0), 'password')).toMatchObject({
      code: 'network',
      message: UNREACHABLE,
    })
    expect(authError(new TypeError('Failed to fetch'), 'send_code')).toMatchObject({ code: 'network', message: UNREACHABLE })
  })

  it.each([
    ['the request limit', new AuthApiError('Request rate limit reached', 429, 'over_request_rate_limit')],
    ['the email limit', new AuthApiError('Email rate limit exceeded', 429, 'over_email_send_rate_limit')],
  ])('asks the owner to wait after hitting %s', (_what, cause) => {
    expect(authError(cause, 'send_code')).toMatchObject({
      code: 'invalid',
      message: 'Too many tries. Wait a minute, then try again.',
    })
  })

  it('reads a malformed email as invalid', () => {
    expect(authError(new AuthApiError('Email address is invalid', 400, 'email_address_invalid'), 'send_code')).toMatchObject({
      code: 'invalid',
      message: 'That doesn’t look like an email address.',
    })
  })

  it('explains the built-in mail server’s limit and what to do instead', () => {
    const cause = new AuthApiError('Email address not authorized', 400, 'email_address_not_authorized')

    expect(authError(cause, 'send_code')).toMatchObject({
      code: 'invalid',
      message: expect.stringContaining('Sign in with your password'),
    })
  })

  it('reads a server fault as temporary', () => {
    expect(authError(new AuthApiError('Database error', 500, 'unexpected_failure'), 'password')).toMatchObject({
      code: 'network',
      message: 'Supabase had a problem signing you in. Try again in a moment.',
    })
  })

  it.each([
    ['password', 'unauthorized', 'Couldn’t sign you in. Check your email and password, then try again.'],
    ['send_code', 'invalid', 'Couldn’t send a code. Try again, or sign in with your password.'],
    ['verify_code', 'unauthorized', 'That code is wrong or has expired. Ask for a new one.'],
    ['sign_out', 'network', 'Couldn’t sign out. Check your connection and try again.'],
  ] as const)('falls back to a plain sentence for %s', (step, code, message) => {
    expect(authError(new AuthApiError('Something new', 418, 'brand_new_code'), step)).toMatchObject({ code, message })
  })

  it('recognises the answers that only mean "no such account"', () => {
    expect(isUnknownEmail(new AuthApiError('Signups not allowed for otp', 422, 'otp_disabled'))).toBe(true)
    expect(isUnknownEmail(new AuthApiError('User not found', 404, 'user_not_found'))).toBe(true)
    expect(isUnknownEmail(new AuthApiError('Email rate limit exceeded', 429, 'over_email_send_rate_limit'))).toBe(false)
    expect(isUnknownEmail(new TypeError('Failed to fetch'))).toBe(false)
  })
})

describe('functionError', () => {
  it.each([
    ['unauthorized', 401, 'unauthorized'],
    ['forbidden', 403, 'unauthorized'],
    ['invalid', 400, 'invalid'],
    ['not_found', 404, 'not_found'],
    ['not_configured', 503, 'not_configured'],
    ['upstream', 502, 'unknown'],
  ] as const)('maps the function’s "%s" and shows its sentence', async (code, status, expected) => {
    const cause = new FunctionsHttpError(reply(status, { error: { code, message: 'A sentence from the function.' } }))
    const error = await functionError('jarvis-command', cause)

    expect(error).toBeInstanceOf(ServiceError)
    expect(error).toMatchObject({ code: expected, message: 'A sentence from the function.', cause })
  })

  it('falls back to the status when the function sends a code it does not know', async () => {
    const cause = new FunctionsHttpError(reply(409, { error: { code: 'conflict', message: 'That task already finished.' } }))

    expect(await functionError('jarvis-command', cause)).toMatchObject({
      code: 'invalid',
      message: 'That task already finished.',
    })
  })

  it('has its own sentence when the function sends a code without one', async () => {
    const cause = new FunctionsHttpError(reply(503, { error: { code: 'not_configured' } }))

    expect(await functionError('elevenlabs-signed-url', cause)).toMatchObject({
      code: 'not_configured',
      message: 'The elevenlabs-signed-url function is missing a secret. Add it in Supabase, then try again.',
    })
  })

  it('accepts a bare error string', async () => {
    const cause = new FunctionsHttpError(reply(401, { error: 'Sign-in required' }))

    expect(await functionError('jarvis-command', cause)).toMatchObject({
      code: 'unauthorized',
      message: 'Sign-in required',
    })
  })

  it('reads Supabase’s own 404 as a function that was never deployed', async () => {
    const cause = new FunctionsHttpError(reply(404, { code: 'NOT_FOUND', message: 'Requested function was not found' }))

    expect(await functionError('jarvis-command', cause)).toMatchObject({
      code: 'not_configured',
      message: 'The jarvis-command function isn’t deployed yet. Deploy it to your Supabase project, then try again.',
    })
  })

  it('reads Supabase’s own 401 as an ended session', async () => {
    const cause = new FunctionsHttpError(reply(401, { code: 'UNAUTHORIZED_JWT', message: 'Invalid JWT' }))

    expect(await functionError('connection-status', cause)).toMatchObject({ code: 'unauthorized', message: SESSION_ENDED })
  })

  it('names the function when it fails without saying why', async () => {
    const cause = new FunctionsHttpError(reply(500, 'Internal Server Error'))

    expect(await functionError('jarvis-command', cause)).toMatchObject({
      code: 'unknown',
      message: 'The jarvis-command function failed. Try again in a moment.',
    })
  })

  it('names the function it could not reach', async () => {
    const cause = new FunctionsFetchError(new TypeError('Failed to fetch'))

    expect(await functionError('elevenlabs-signed-url', cause)).toMatchObject({
      code: 'network',
      message:
        'Couldn’t reach the elevenlabs-signed-url function. Check your connection, and make sure the function is deployed.',
      cause,
    })
  })

  it('says so when the function took too long', async () => {
    const cause = new FunctionsFetchError(new DOMException('The operation was aborted.', 'AbortError'))

    expect(await functionError('jarvis-command', cause)).toMatchObject({
      code: 'network',
      message: 'The jarvis-command function took too long to answer. Try again in a moment.',
    })
  })

  it('reads a relay failure as Supabase not running the function', async () => {
    const cause = new FunctionsRelayError(reply(500, 'relay error'))

    expect(await functionError('connection-status', cause)).toMatchObject({
      code: 'network',
      message: 'Supabase couldn’t run the connection-status function. Try again in a moment.',
    })
  })
})
