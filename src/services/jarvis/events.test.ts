import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { REALTIME_TABLES } from '@/lib/types'
import type { ChangeEvent, RealtimeStatus, RealtimeTable } from '@/lib/types'
import type { AuthUser } from '@/services/types'

import { toChangeEvent } from './events'
import type { FetchLike } from './http'
import { createJarvisBackendService } from './index'
import { createSseParser } from './sse'

describe('the event-stream parser', () => {
  function parse(chunks: string[]): string[] {
    const out: string[] = []
    const parser = createSseParser((data) => out.push(data))
    for (const chunk of chunks) parser.push(chunk)
    return out
  }

  it('waits for the blank line, however the text is cut', () => {
    const text = 'data: {"a":1}\n\ndata: {"b":2}\n\n'
    const whole = parse([text])
    expect(whole).toEqual(['{"a":1}', '{"b":2}'])
    for (let cut = 1; cut < text.length; cut += 1) {
      expect(parse([text.slice(0, cut), text.slice(cut)])).toEqual(whole)
    }
    expect(parse(text.split(''))).toEqual(whole)
  })

  it('handles CRLF (even split between chunks), comments, other fields and multi-line data', () => {
    expect(parse(['data: one\r', '\n\r', '\n'])).toEqual(['one'])
    expect(parse([': heartbeat\n\n', 'event: change\nid: 7\nretry: 1000\ndata: x\n\n'])).toEqual(['x'])
    expect(parse(['data: first\ndata:second\n\n'])).toEqual(['first\nsecond'])
    expect(parse(['data: unfinished'])).toEqual([])
    expect(parse(['\n\n: ping\n\n'])).toEqual([])
  })
})

describe('reading one change', () => {
  const all = new Set<RealtimeTable>(REALTIME_TABLES)

  it('keeps calls free of transcripts and deletes free of rows', () => {
    const call = { id: 'c1', outcome: 'missed', transcript: [{ role: 'agent', text: 'Hi', t: 0 }] }
    expect(toChangeEvent({ table: 'calls', type: 'UPDATE', id: 'c1', row: call }, all)).toEqual({
      table: 'calls',
      type: 'UPDATE',
      id: 'c1',
      row: { id: 'c1', outcome: 'missed' },
    })
    expect(toChangeEvent({ table: 'tasks', type: 'DELETE', id: 't1', row: { id: 't1' } }, all)?.row).toBeNull()
  })

  it('ignores anything that is not a change on a wanted table', () => {
    expect(toChangeEvent({ table: 'tasks', type: 'INSERT', id: 't1', row: { id: 't1' } }, new Set(['alerts']))).toBeNull()
    expect(toChangeEvent({ table: 'shops', type: 'INSERT', id: 's', row: {} }, all)).toBeNull()
    expect(toChangeEvent({ table: 'tasks', type: 'UPSERT', id: 't', row: {} }, all)).toBeNull()
    expect(toChangeEvent({ table: 'tasks', type: 'INSERT', row: null }, all)).toBeNull()
    expect(toChangeEvent('nope', all)).toBeNull()
  })
})

// ── The subscription, against a stream the test controls ──────────────────

interface Connection {
  url: string
  headers: Record<string, string>
  signal: AbortSignal
  send(text: string): void
  end(): void
}

const encoder = new TextEncoder()

function streamServer() {
  const connections: Connection[] = []
  let next: 'stream' | 'fail' | 401 = 'stream'
  const fetch: FetchLike = async (url, init) => {
    const signal = init.signal as AbortSignal
    if (url.includes('/app/auth/')) return new Response(null, { status: 204 })
    if (next === 'fail') throw new TypeError('Failed to fetch')
    if (next === 401) return new Response(null, { status: 401 })
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c
      },
    })
    signal.addEventListener('abort', () => {
      try {
        controller.error(new DOMException('aborted', 'AbortError'))
      } catch {
        // Already closed.
      }
    })
    connections.push({
      url,
      headers: init.headers as Record<string, string>,
      signal,
      send: (text) => controller.enqueue(encoder.encode(text)),
      end: () => controller.close(),
    })
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  }
  return {
    fetch,
    connections,
    open: () => connections.filter((connection) => !connection.signal.aborted),
    answerWith(value: typeof next) {
      next = value
    },
  }
}

const flush = () => vi.advanceTimersByTimeAsync(0)
const task = { id: 't1', title: 'Fix it', status: 'running' }

let server: ReturnType<typeof streamServer>
let events: ChangeEvent[]
let statuses: RealtimeStatus[]

function subscribe(tables: readonly RealtimeTable[] = REALTIME_TABLES) {
  const api = createJarvisBackendService('https://jarvis.test', { fetch: server.fetch })
  const unsubscribe = api.subscribe(tables, (event) => events.push(event), (status) => statuses.push(status))
  return { api, unsubscribe }
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  localStorage.setItem('jarvis.session', JSON.stringify({ token: 'abc', user: { id: 'u', email: null } }))
  server = streamServer()
  events = []
  statuses = []
})

afterEach(() => {
  vi.useRealTimers()
})

describe('subscribe', () => {
  it('opens the stream with the bearer token and delivers changes as they arrive', async () => {
    const { unsubscribe } = subscribe(['tasks', 'alerts'])
    await flush()
    expect(statuses).toEqual(['connecting', 'live'])
    const [connection] = server.connections
    expect(connection.url).toBe('https://jarvis.test/app/events?tables=tasks%2Calerts')
    expect(connection.headers).toMatchObject({ Authorization: 'Bearer abc', Accept: 'text/event-stream' })

    const line = `data: ${JSON.stringify({ table: 'tasks', type: 'UPDATE', id: 't1', row: task })}\n\n`
    connection.send(': connected\n\n')
    connection.send(line.slice(0, 17))
    await flush()
    expect(events).toEqual([])
    connection.send(line.slice(17))
    connection.send(': ping\n\n')
    connection.send(`data: ${JSON.stringify({ table: 'calls', type: 'INSERT', id: 'c1', row: { id: 'c1' } })}\n\n`)
    await flush()
    expect(events).toEqual([{ table: 'tasks', type: 'UPDATE', id: 't1', row: task }])
    unsubscribe()
  })

  it('reconnects with backoff and reports offline in between', async () => {
    const { unsubscribe } = subscribe()
    await flush()
    server.answerWith('fail')
    server.connections[0].end()
    await flush()
    expect(statuses).toEqual(['connecting', 'live', 'offline'])

    const attempts = () => server.connections.length
    await vi.advanceTimersByTimeAsync(999)
    expect(attempts()).toBe(1)
    await vi.advanceTimersByTimeAsync(1) // 1s: fails again
    await vi.advanceTimersByTimeAsync(1_999)
    server.answerWith('stream')
    expect(attempts()).toBe(1)
    await vi.advanceTimersByTimeAsync(1) // 2s later: opens
    expect(attempts()).toBe(2)
    expect(statuses).toEqual(['connecting', 'live', 'offline', 'live'])
    unsubscribe()
  })

  it('treats a silent stream as dropped, but heartbeats keep it alive', async () => {
    const { unsubscribe } = subscribe()
    await flush()
    for (let i = 0; i < 4; i += 1) {
      await vi.advanceTimersByTimeAsync(25_000)
      server.connections[0].send(': ping\n\n')
    }
    await flush()
    expect(statuses).toEqual(['connecting', 'live'])
    await vi.advanceTimersByTimeAsync(60_000)
    expect(statuses).toEqual(['connecting', 'live', 'offline'])
    expect(server.connections[0].signal.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(server.open()).toHaveLength(1)
    expect(statuses.at(-1)).toBe('live')
    unsubscribe()
  })

  it('follows the browser going offline and back online', async () => {
    const { unsubscribe } = subscribe()
    await flush()
    window.dispatchEvent(new Event('offline'))
    await flush()
    expect(statuses.at(-1)).toBe('offline')
    expect(server.open()).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(server.connections).toHaveLength(1)

    window.dispatchEvent(new Event('online'))
    await flush()
    expect(server.open()).toHaveLength(1)
    expect(statuses.at(-1)).toBe('live')
    unsubscribe()
  })

  it('signs out and stops on a 401', async () => {
    server.answerWith(401)
    const { api } = subscribe()
    const changes: (AuthUser | null)[] = []
    api.auth.onChange((user) => changes.push(user))
    await flush()
    expect(changes).toEqual([null])
    expect(statuses).toEqual(['connecting', 'offline'])
    await vi.advanceTimersByTimeAsync(60_000)
    expect(server.connections).toHaveLength(0)
  })

  it('unsubscribes cleanly, even straight away (React StrictMode)', async () => {
    const first = subscribe()
    first.unsubscribe()
    const second = subscribe()
    await flush()
    expect(server.open()).toHaveLength(1)
    expect(statuses).toEqual(['connecting', 'connecting', 'live'])

    second.unsubscribe()
    second.unsubscribe()
    await flush()
    expect(server.open()).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(120_000)
    window.dispatchEvent(new Event('online'))
    await flush()
    // One request each; the first was aborted at once. Nothing opened since.
    expect(server.connections).toHaveLength(2)
    expect(server.open()).toHaveLength(0)
    expect(statuses).toEqual(['connecting', 'connecting', 'live'])
  })
})
