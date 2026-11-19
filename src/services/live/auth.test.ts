import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthUser } from '@/services/types'

import { fake } from './testing/fakeSupabase'
import { createLiveService } from '.'

vi.mock('@/lib/env', () => ({
  SUPABASE_URL: 'https://jarvis-test.supabase.co',
  SUPABASE_KEY: 'sb_publishable_test',
  IS_DEMO: false,
}))
vi.mock('@supabase/supabase-js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const shared = await import('./testing/fakeSupabase')
  return { ...actual, createClient: () => shared.fake.client }
})

const { auth } = createLiveService()
const session = { access_token: 'token', user: { id: 'owner-1', email: 'owner@example.com' } }

beforeEach(() => fake.reset())

describe('auth', () => {
  it('reads the signed-in owner from the stored session', async () => {
    expect(await auth.getUser()).toBeNull()
    fake.auth.getSession.mockResolvedValue({ data: { session }, error: null })
    expect(await auth.getUser()).toEqual({ id: 'owner-1', email: 'owner@example.com' })
  })

  it('resolves null instead of throwing when the session cannot be read', async () => {
    fake.auth.getSession.mockRejectedValue(new Error('storage broke'))
    expect(await auth.getUser()).toBeNull()
  })

  it('passes every auth event on as the current owner, and stops on unsubscribe', () => {
    const seen: (AuthUser | null)[] = []
    const stop = auth.onChange((user) => seen.push(user))
    fake.emitAuth('SIGNED_IN', session)
    fake.emitAuth('TOKEN_REFRESHED', session)
    fake.emitAuth('SIGNED_OUT', null)
    stop()
    fake.emitAuth('SIGNED_IN', session)

    expect(seen).toEqual([{ id: 'owner-1', email: 'owner@example.com' }, { id: 'owner-1', email: 'owner@example.com' }, null])
    expect(fake.authListenerCount()).toBe(0)
  })

  it('signs in with a password and says plainly when it does not match', async () => {
    await auth.signInWithPassword(' owner@example.com ', 'secret')
    expect(fake.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'owner@example.com', password: 'secret' })

    fake.auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: new AuthApiError('Invalid login credentials', 400, 'invalid_credentials'),
    })
    await expect(auth.signInWithPassword('owner@example.com', 'wrong')).rejects.toMatchObject({
      code: 'unauthorized',
      message: 'That email and password don’t match.',
    })
  })

  it('reads a failed sign-in request as a connection problem', async () => {
    fake.auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: new AuthRetryableFetchError('Failed to fetch', 0),
    })
    await expect(auth.signInWithPassword('owner@example.com', 'x')).rejects.toMatchObject({ code: 'network' })
  })

  it('asks for a code without ever creating an account', async () => {
    await auth.sendEmailCode('owner@example.com')
    expect(fake.auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'owner@example.com',
      options: { shouldCreateUser: false },
    })
  })

  it('does not reveal that an email has no account', async () => {
    fake.auth.signInWithOtp.mockResolvedValue({
      data: { user: null, session: null },
      error: new AuthApiError('Signups not allowed for otp', 422, 'otp_disabled'),
    })
    await expect(auth.sendEmailCode('stranger@example.com')).resolves.toBeUndefined()
  })

  it('verifies an emailed code as type email', async () => {
    fake.auth.verifyOtp.mockResolvedValue({ data: { user: session.user, session }, error: null })
    await auth.verifyEmailCode('owner@example.com', '123 456')
    expect(fake.auth.verifyOtp).toHaveBeenCalledWith({ email: 'owner@example.com', token: '123456', type: 'email' })

    fake.auth.verifyOtp.mockResolvedValue({
      data: { user: null, session: null },
      error: new AuthApiError('Token has expired or is invalid', 403, 'otp_expired'),
    })
    await expect(auth.verifyEmailCode('owner@example.com', '000000')).rejects.toMatchObject({
      code: 'unauthorized',
      message: 'That code is wrong or has expired. Ask for a new one.',
    })
  })

  it('signs this device out even without a connection', async () => {
    await auth.signOut()
    expect(fake.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })

    fake.auth.signOut.mockResolvedValue({ error: new AuthRetryableFetchError('Failed to fetch', 0) })
    await expect(auth.signOut()).resolves.toBeUndefined()
  })

  it('refuses an empty email before asking Supabase', async () => {
    await expect(auth.sendEmailCode('  ')).rejects.toMatchObject({ code: 'invalid' })
    expect(fake.auth.signInWithOtp).not.toHaveBeenCalled()
  })
})

