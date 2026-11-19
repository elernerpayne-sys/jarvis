/**
 * The owner's session: the bearer token and who it belongs to, kept in
 * localStorage under "jarvis.session" so an installed app stays signed in.
 *
 * Storage can be missing or throw (private windows, blocked site data), so
 * every access is guarded and the session also lives in memory for the page.
 */
import type { AuthUser } from '@/services/types'

export const SESSION_KEY = 'jarvis.session'

export interface Session {
  token: string
  user: AuthUser
}

export interface SessionStore {
  get(): Session | null
  /** Saves (or, with null, forgets) the session and tells every listener when it changed. */
  set(session: Session | null): void
  onChange(listener: (user: AuthUser | null) => void): () => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** A user object from storage or the backend, or null when it is not one. */
export function toUser(value: unknown): AuthUser | null {
  if (!isRecord(value)) return null
  const id = typeof value.id === 'string' || typeof value.id === 'number' ? String(value.id) : ''
  if (id === '') return null
  return { id, email: typeof value.email === 'string' ? value.email : null }
}

/** A session from storage or a sign-in answer, or null when it is not one. */
export function toSession(value: unknown): Session | null {
  if (!isRecord(value) || typeof value.token !== 'string' || value.token === '') return null
  const user = toUser(value.user)
  return user ? { token: value.token, user } : null
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function load(): Session | null {
  try {
    const raw = storage()?.getItem(SESSION_KEY)
    return raw ? toSession(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

function save(session: Session | null): void {
  try {
    const store = storage()
    if (!store) return
    if (session) store.setItem(SESSION_KEY, JSON.stringify(session))
    else store.removeItem(SESSION_KEY)
  } catch {
    // Not saved for next time; this page still has it in memory.
  }
}

export function createSessionStore(): SessionStore {
  let current = load()
  const listeners = new Set<(user: AuthUser | null) => void>()

  return {
    get: () => current,

    set(session) {
      const changed = current?.token !== session?.token || current?.user.id !== session?.user.id
      current = session
      save(session)
      if (!changed) return
      for (const listener of [...listeners]) {
        try {
          listener(session ? { ...session.user } : null)
        } catch (error) {
          console.error('A sign-in listener failed.', error)
        }
      }
    },

    onChange(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
