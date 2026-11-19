/**
 * Sign-in for the one owner account: a password, or a code sent by email.
 * There is no sign-up here, and nothing here can create an account.
 */
import type { Session, SupabaseClient } from '@supabase/supabase-js'

import { ServiceError } from '@/services/errors'
import type { AuthApi, AuthUser } from '@/services/types'

import { getClient } from './client'
import { WRONG_CODE, authError, isUnknownEmail } from './errors'
import type { AuthStep } from './errors'

function toUser(session: Session | null): AuthUser | null {
  return session ? { id: session.user.id, email: session.user.email ?? null } : null
}

function requireEmail(email: string): string {
  const trimmed = email.trim()
  if (trimmed === '') throw new ServiceError('invalid', 'Enter your email address.')
  return trimmed
}

/**
 * Makes one auth request. supabase-js normally returns its errors, but a bad
 * configuration or a broken storage can still throw, and that has to be
 * mapped as well.
 */
async function ask<R>(step: AuthStep, request: (auth: SupabaseClient['auth']) => Promise<R>): Promise<R> {
  try {
    return await request(getClient().auth)
  } catch (cause) {
    throw authError(cause, step)
  }
}

export const auth: AuthApi = {
  async getUser() {
    try {
      // getSession reads the stored session; it only goes to the network when
      // the saved token has already expired and needs refreshing.
      const { data } = await getClient().auth.getSession()
      return toUser(data.session)
    } catch {
      return null
    }
  },

  onChange(callback) {
    try {
      // Keep this handler synchronous. supabase-js waits for its subscribers
      // one after another, so a handler that awaits another auth call can
      // hold up a token refresh. Every event carries the current session, so
      // passing that on is all there is to do.
      const { data } = getClient().auth.onAuthStateChange((_event, session) => {
        callback(toUser(session))
      })
      return () => data.subscription.unsubscribe()
    } catch {
      // No usable client (bad configuration), so there will be no events.
      // The sign-in screen reports the real problem when the owner tries.
      return () => {}
    }
  },

  async signInWithPassword(email, password) {
    const address = requireEmail(email)
    if (password === '') throw new ServiceError('invalid', 'Enter your password.')
    const { error } = await ask('password', (api) => api.signInWithPassword({ email: address, password }))
    if (error) throw authError(error, 'password')
  },

  async sendEmailCode(email) {
    const address = requireEmail(email)
    const { error } = await ask('send_code', (api) =>
      // Without shouldCreateUser: false, asking for a code would create the account.
      api.signInWithOtp({ email: address, options: { shouldCreateUser: false } }),
    )
    // "No such account" resolves like a success: the screen says the same
    // thing either way and never confirms which addresses exist.
    if (error && !isUnknownEmail(error)) throw authError(error, 'send_code')
  },

  async verifyEmailCode(email, code) {
    const address = requireEmail(email)
    const token = code.replace(/\s+/g, '')
    if (token === '') throw new ServiceError('invalid', 'Enter the code from the email.')
    const { data, error } = await ask('verify_code', (api) => api.verifyOtp({ email: address, token, type: 'email' }))
    if (error) throw authError(error, 'verify_code')
    if (!data.session) throw new ServiceError('unauthorized', WRONG_CODE)
  },

  async signOut() {
    // "local" signs this device out before it tells the server, so it works
    // with no connection. The default scope would leave the owner signed in
    // whenever the server could not be reached.
    const { error } = await ask('sign_out', (api) => api.signOut({ scope: 'local' }))
    if (!error) return
    // Telling the server can still fail. That only matters if this device is
    // somehow still signed in.
    const { data } = await ask('sign_out', (api) => api.getSession())
    if (data.session) throw authError(error, 'sign_out')
  },
}
