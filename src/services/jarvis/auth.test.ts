import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ServiceError } from '@/services/errors'
import type { AuthUser } from '@/services/types'

import { WRONG_CODE, WRONG_PASSWORD } from './auth'
import { createJarvisBackendService } from './index'
import { SESSION_KEY } from './session'
import { BASE_URL, EMAIL_CODE, OWNER, createReferenceServer } from './testing/referenceServer'
import type { ReferenceServer } from './testing/referenceServer'

let server: ReferenceServer

beforeEach(() => {
  localStorage.clear()
  server = createReferenceServer()
})

afterEach(() => {
  server.dispose()
})

function service(fetch = server.fetch) {
  return createJarvisBackendService(BASE_URL, { fetch })
}

async function rejection(promise: Promise<unknown>): Promise<ServiceError> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  )
  expect(error).toBeInstanceOf(ServiceError)
  return error as ServiceError
}

const owner: AuthUser = { id: OWNER.id, email: OWNER.email }

describe('signing in', () => {
  it('starts signed out without touching the network', async () => {
    expect(await service().auth.getUser()).toBeNull()
    expect(server.log).toEqual([])
  })

  it('signs in with a password, remembers it, and announces it', async () => {
    const api = service()
    const changes: (AuthUser | null)[] = []
    api.auth.onChange((user) => changes.push(user))

    const wrong = await rejection(api.auth.signInWithPassword(OWNER.email, 'nope'))
    expect(wrong).toMatchObject({ code: 'unauthorized', message: WRONG_PASSWORD })
    expect(changes).toEqual([])

    await api.auth.signInWithPassword(` ${OWNER.email} `, OWNER.password)
    expect(changes).toEqual([owner])
    expect(await api.auth.getUser()).toEqual(owner)
    expect(JSON.parse(localStorage.getItem(SESSION_KEY) ?? '{}')).toMatchObject({ user: owner })

    // A reload reads the saved session.
    expect(await service().auth.getUser()).toEqual(owner)
  })

  it('checks the form before asking the backend', async () => {
    const api = service()
    expect((await rejection(api.auth.signInWithPassword(' ', 'x'))).code).toBe('invalid')
    expect((await rejection(api.auth.signInWithPassword(OWNER.email, ''))).code).toBe('invalid')
    expect((await rejection(api.auth.verifyEmailCode(OWNER.email, '  '))).code).toBe('invalid')
    expect(server.log).toEqual([])
  })

  it('signs in with an emailed code, and never says whether an address exists', async () => {
    const api = service()
    await api.auth.sendEmailCode('stranger@example.com')
    await api.auth.sendEmailCode(OWNER.email)
    expect(server.log).toEqual(['POST /app/auth/code', 'POST /app/auth/code'])

    const wrong = await rejection(api.auth.verifyEmailCode(OWNER.email, '000000'))
    expect(wrong).toMatchObject({ code: 'unauthorized', message: WRONG_CODE })
    // Spaces typed into the code are ignored.
    await api.auth.verifyEmailCode(OWNER.email, `${EMAIL_CODE.slice(0, 3)} ${EMAIL_CODE.slice(3)}`)
    expect(await api.auth.getUser()).toEqual(owner)
  })

  it('reports too many tries', async () => {
    const api = service(async () => new Response(JSON.stringify({ error: { code: 'invalid', message: 'Slow down.' } }), { status: 429 }))
    expect(await rejection(api.auth.signInWithPassword(OWNER.email, 'x'))).toMatchObject({ code: 'invalid', message: 'Slow down.' })
  })
})

describe('the session ending', () => {
  it('signs out everywhere when any request gets a 401', async () => {
    const api = service()
    await api.auth.signInWithPassword(OWNER.email, OWNER.password)
    const changes: (AuthUser | null)[] = []
    api.auth.onChange((user) => changes.push(user))

    server.tokens.clear()
    const error = await rejection(api.listTasks())
    expect(error).toMatchObject({ code: 'unauthorized', message: 'Your session has ended. Sign in again.' })
    expect(changes).toEqual([null])
    expect(await api.auth.getUser()).toBeNull()
    expect(localStorage.getItem(SESSION_KEY)).toBeNull()
  })

  it('checks a saved token once in the background and drops it when it no longer works', async () => {
    await service().auth.signInWithPassword(OWNER.email, OWNER.password)
    server.tokens.clear()
    const api = service()
    const changes: (AuthUser | null)[] = []
    api.auth.onChange((user) => changes.push(user))

    expect(await api.auth.getUser()).toEqual(owner)
    await vi.waitFor(() => expect(changes).toEqual([null]))
    expect(server.log.filter((line) => line === 'GET /app/auth/me')).toHaveLength(1)
  })

  it('does not sign out a newer session because of an older request', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const api = service(async (input, init) => {
      const answer = await server.fetch(input, init)
      if (input.endsWith('/app/tasks')) await gate
      return answer
    })
    await api.auth.signInWithPassword(OWNER.email, OWNER.password)
    server.tokens.clear()
    const stale = api.listTasks()
    await api.auth.signInWithPassword(OWNER.email, OWNER.password)
    release()
    expect((await rejection(stale)).code).toBe('unauthorized')
    expect(await api.auth.getUser()).toEqual(owner)
  })

  it('signs out locally even when the backend cannot be reached', async () => {
    const api = service()
    await api.auth.signInWithPassword(OWNER.email, OWNER.password)
    const token = [...server.tokens][0]
    await api.auth.signOut()
    await vi.waitFor(() => expect(server.tokens.has(token)).toBe(false))
    expect(await api.auth.getUser()).toBeNull()

    await api.auth.signInWithPassword(OWNER.email, OWNER.password)
    const offline = createJarvisBackendService(BASE_URL, {
      fetch: async () => {
        throw new TypeError('Failed to fetch')
      },
    })
    expect(await offline.auth.getUser()).toEqual(owner)
    const changes: (AuthUser | null)[] = []
    offline.auth.onChange((user) => changes.push(user))
    await offline.auth.signOut()
    expect(changes).toEqual([null])
    expect(localStorage.getItem(SESSION_KEY)).toBeNull()
  })

  it('still works for the page when storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const api = service()
    expect(await api.auth.getUser()).toBeNull()
    await api.auth.signInWithPassword(OWNER.email, OWNER.password)
    expect(await api.auth.getUser()).toEqual(owner)
    expect((await api.listTasks()).length).toBeGreaterThan(0)
  })
})
