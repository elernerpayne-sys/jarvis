import { afterEach, describe, expect, it, vi } from 'vitest'

import { ServiceError } from '@/services/errors'

import { SAY } from './errors'
import { createJarvisBackendService } from './index'
import type { FetchLike } from './http'

afterEach(() => {
  vi.useRealTimers()
})

function answering(status: number, body?: unknown, raw?: string): FetchLike {
  return async () => new Response(raw ?? (body === undefined ? null : JSON.stringify(body)), { status })
}

async function failure(fetch: FetchLike, call = (api: ReturnType<typeof createJarvisBackendService>) => api.listTasks()) {
  localStorage.clear()
  const api = createJarvisBackendService('https://jarvis.test', { fetch })
  const error = await call(api).then(
    () => null,
    (reason: unknown) => reason,
  )
  expect(error).toBeInstanceOf(ServiceError)
  const { code, message } = error as ServiceError
  return { code, message }
}

const envelope = (code: string, message: string) => ({ error: { code, message } })

describe('error mapping', () => {
  it('says the connection failed when nothing came back', async () => {
    const fetch: FetchLike = async () => {
      throw new TypeError('Failed to fetch')
    }
    expect(await failure(fetch)).toEqual({
      code: 'network',
      message: 'Couldn’t reach Jarvis. Check your connection and try again.',
    })
  })

  it('maps each status and error code', async () => {
    expect(await failure(answering(401))).toEqual({ code: 'unauthorized', message: 'Your session has ended. Sign in again.' })
    expect(await failure(answering(403, envelope('forbidden', 'Owner only.')))).toEqual({ code: 'unauthorized', message: 'Owner only.' })
    expect(await failure(answering(403))).toEqual({ code: 'unauthorized', message: SAY.notOwner })
    expect(await failure(answering(400, envelope('invalid', 'Pick a repo.')))).toEqual({ code: 'invalid', message: 'Pick a repo.' })
    expect(await failure(answering(409))).toEqual({ code: 'invalid', message: SAY.rejected })
    expect(await failure(answering(404, envelope('not_found', 'Couldn’t find that task.')))).toEqual({
      code: 'not_found',
      message: 'Couldn’t find that task.',
    })
    expect(await failure(answering(503, envelope('not_configured', 'ElevenLabs isn’t set up.')))).toEqual({
      code: 'not_configured',
      message: 'ElevenLabs isn’t set up.',
    })
    expect(await failure(answering(502, envelope('upstream', 'ElevenLabs is down.')))).toEqual({
      code: 'unknown',
      message: 'ElevenLabs is down.',
    })
    expect(await failure(answering(500, undefined, '<h1>Oops</h1>'))).toEqual({ code: 'unknown', message: SAY.unknown })
    expect(await failure(answering(429))).toEqual({ code: 'invalid', message: SAY.tooMany })
  })

  it('treats an endpoint that is not built as "not supported yet"', async () => {
    const notBuilt = { code: 'not_configured', message: 'Your Jarvis backend doesn’t support this yet.' }
    expect(await failure(answering(501))).toEqual(notBuilt)
    expect(await failure(answering(404, undefined, 'Cannot GET /app/tasks'))).toEqual(notBuilt)
    expect(await failure(answering(404, envelope('not_configured', 'Tasks are coming soon.')))).toEqual({
      code: 'not_configured',
      message: 'Tasks are coming soon.',
    })
  })

  it('refuses a success it cannot read', async () => {
    expect(await failure(answering(200, undefined, 'not json'))).toEqual({ code: 'unknown', message: SAY.unreadable })
    expect(await failure(answering(200, { nope: true }))).toEqual({ code: 'unknown', message: SAY.unreadable })
  })

  it('gives up after 15 seconds', async () => {
    vi.useFakeTimers()
    const fetch: FetchLike = (_input, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    const pending = failure(fetch)
    await vi.advanceTimersByTimeAsync(14_999)
    let settled = false
    void pending.then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await pending).toEqual({ code: 'network', message: SAY.slow })
  })
})

describe('requests', () => {
  it('sends JSON with the bearer token to the base address', async () => {
    localStorage.setItem('jarvis.session', JSON.stringify({ token: 'abc', user: { id: 'u', email: null } }))
    const seen: { url: string; init: RequestInit }[] = []
    const api = createJarvisBackendService('https://jarvis.test///', {
      fetch: async (url, init) => {
        seen.push({ url, init })
        return new Response(JSON.stringify({ task: { id: 't1' } }), { status: 201 })
      },
    })
    await api.createTask({ repo: ' me/app ', instructions: ' Go ' })
    expect(seen[0].url).toBe('https://jarvis.test/app/tasks')
    expect(seen[0].init.method).toBe('POST')
    expect(seen[0].init.headers).toMatchObject({ Authorization: 'Bearer abc', 'Content-Type': 'application/json' })
    expect(JSON.parse(String(seen[0].init.body))).toEqual({ repo: 'me/app', instructions: 'Go' })
  })
})
