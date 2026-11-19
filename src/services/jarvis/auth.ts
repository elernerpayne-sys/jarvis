/**
 * Sign-in for the one owner: a password, or a 6-digit code sent by email.
 * Nothing here can create an account. The session is a bearer token from
 * your Jarvis backend, kept on this device (see session.ts).
 */
import { ServiceError } from '@/services/errors'
import type { AuthApi } from '@/services/types'

import { SAY, httpError, readErrorBody, unreadable } from './errors'
import type { Answer, HttpClient } from './http'
import { toSession, toUser } from './session'

export const WRONG_PASSWORD = 'That email and password don’t match.'
export const WRONG_CODE = 'That code is wrong or has expired. Ask for a new one.'

function requireEmail(email: string): string {
  const trimmed = email.trim()
  if (trimmed === '') throw new ServiceError('invalid', 'Enter your email address.')
  return trimmed
}

/** A sign-in endpoint said no. Here a 401 means "wrong", not "session ended". */
function refused(answer: Answer, wrong: string): ServiceError {
  const message = readErrorBody(answer.body)?.message
  if (answer.status === 401) return new ServiceError('unauthorized', message ?? wrong, { cause: answer })
  if (answer.status === 429) return new ServiceError('invalid', message ?? SAY.tooMany, { cause: answer })
  return httpError(answer.status, answer.body)
}

export function createAuth(client: HttpClient): AuthApi {
  const { sessions } = client
  let checked = false

  /** Saves the session a sign-in endpoint answered with. */
  function accept(answer: Answer, wrong: string) {
    if (!answer.ok) throw refused(answer, wrong)
    const session = toSession(answer.body)
    if (!session) throw unreadable(answer.body)
    sessions.set(session)
  }

  /**
   * Once per page load, asks the backend whether the saved token still
   * works. A 401 signs this device out (http.ts); anything else is ignored,
   * so a phone with no signal still opens on its last screen.
   */
  function checkOnce() {
    const session = sessions.get()
    if (checked || !session) return
    checked = true
    client.request('GET', '/app/auth/me').then(
      (body) => {
        const user = toUser((body as { user?: unknown } | undefined)?.user)
        const current = sessions.get()
        if (user && current?.token === session.token && user.id === current.user.id) {
          sessions.set({ token: current.token, user })
        }
      },
      () => undefined,
    )
  }

  return {
    async getUser() {
      const session = sessions.get()
      checkOnce()
      return session ? { ...session.user } : null
    },

    onChange: (callback) => sessions.onChange(callback),

    async signInWithPassword(email, password) {
      const address = requireEmail(email)
      if (password === '') throw new ServiceError('invalid', 'Enter your password.')
      const answer = await client.send('POST', '/app/auth/login', { body: { email: address, password }, auth: false })
      checked = true
      accept(answer, WRONG_PASSWORD)
    },

    async sendEmailCode(email) {
      const address = requireEmail(email)
      const answer = await client.send('POST', '/app/auth/code', { body: { email: address }, auth: false })
      // "No such account" counts as sent, so the screen never confirms which addresses exist.
      if (answer.ok || readErrorBody(answer.body)?.code === 'not_found') return
      throw refused(answer, 'Couldn’t send a code. Try again, or sign in with your password.')
    },

    async verifyEmailCode(email, code) {
      const address = requireEmail(email)
      const token = code.replace(/\s+/g, '')
      if (token === '') throw new ServiceError('invalid', 'Enter the code from the email.')
      const answer = await client.send('POST', '/app/auth/verify', { body: { email: address, code: token }, auth: false })
      checked = true
      if (answer.status === 400) {
        throw new ServiceError('invalid', readErrorBody(answer.body)?.message ?? WRONG_CODE, { cause: answer })
      }
      accept(answer, WRONG_CODE)
    },

    async signOut() {
      const token = sessions.get()?.token
      // This device is signed out first, so it works with no connection.
      sessions.set(null)
      if (!token) return
      // Telling the backend is best effort: the token is gone from here either way.
      client
        .send('POST', '/app/auth/logout', { auth: false, headers: { Authorization: `Bearer ${token}` } })
        .catch(() => undefined)
    },
  }
}
