/**
 * Live updates from GET /app/events, a Server-Sent Events stream read with
 * fetch (EventSource cannot send the bearer header).
 *
 * Status: "connecting" until the first stream opens, "live" while it is open,
 * "offline" while it is down. A dropped stream is reopened after 1s, 2s, 5s,
 * then every 10s; going back online reopens it at once. A stream that sends
 * nothing at all (not even the 25-second heartbeat) for a minute counts as
 * dropped. The app refetches everything after it comes back.
 */
import type { ChangeEvent, ChangeType, RealtimeStatus, RealtimeTable } from '@/lib/types'
import type { JarvisService } from '@/services/types'

import { REQUEST_TIMEOUT_MS } from './http'
import type { HttpClient } from './http'
import { createSseParser } from './sse'

export const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000]
export const IDLE_LIMIT_MS = 60_000

const TYPES: readonly ChangeType[] = ['INSERT', 'UPDATE', 'DELETE']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** One event's data, checked. Null when it is not a change on one of `tables`. */
export function toChangeEvent(data: unknown, tables: ReadonlySet<RealtimeTable>): ChangeEvent | null {
  if (!isRecord(data)) return null
  const table = tables.has(data.table as RealtimeTable) ? (data.table as RealtimeTable) : null
  const type = TYPES.find((known) => known === data.type)
  const rawId = data.id ?? (isRecord(data.row) ? data.row.id : undefined)
  const id = typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : ''
  if (!table || !type || id === '') return null
  let row: Record<string, unknown> | null = null
  if (type !== 'DELETE') {
    if (!isRecord(data.row)) return null
    row = { ...data.row }
    // Lists hold call summaries; a transcript never belongs in them.
    if (table === 'calls') delete row.transcript
  }
  // The row is the backend's row for this table, which lib/types.ts describes.
  return { table, type, id, row } as ChangeEvent
}

export function createSubscribe(client: HttpClient): JarvisService['subscribe'] {
  return (tables, onChange, onStatus) => {
    const wanted = new Set(tables)
    let active = true
    let online = typeof navigator === 'undefined' || navigator.onLine !== false
    let reported: RealtimeStatus | null = null
    let stream: AbortController | null = null
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let idleTimer: ReturnType<typeof setTimeout> | undefined
    let attempt = 0

    function report(status: RealtimeStatus) {
      if (!active || status === reported) return
      reported = status
      onStatus?.(status)
    }

    function close() {
      stream?.abort()
      stream = null
      clearTimeout(idleTimer)
      clearTimeout(retryTimer)
    }

    function dropped() {
      close()
      report('offline')
      if (!active || !online) return
      const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]
      attempt += 1
      retryTimer = setTimeout(() => void connect(), delay)
    }

    function handleData(text: string) {
      let data: unknown
      try {
        data = JSON.parse(text)
      } catch {
        return
      }
      const event = toChangeEvent(data, wanted)
      if (!event || !active) return
      try {
        onChange(event)
      } catch (error) {
        console.error('A live update handler failed.', error)
      }
    }

    async function connect() {
      if (!active || !online) return
      close()
      const mine = new AbortController()
      stream = mine
      const current = () => active && stream === mine
      // Until the stream opens this is the usual request limit; after that, the idle limit.
      const watch = (ms: number) => {
        clearTimeout(idleTimer)
        idleTimer = setTimeout(() => current() && dropped(), ms)
      }
      const token = client.sessions.get()?.token ?? null
      watch(REQUEST_TIMEOUT_MS)

      let response: Response
      try {
        response = await client.fetch(client.url('/app/events', { tables: [...wanted].join(',') }), {
          method: 'GET',
          headers: { Accept: 'text/event-stream', ...client.authHeaders() },
          cache: 'no-store',
          signal: mine.signal,
        })
      } catch {
        if (current()) dropped()
        return
      }
      if (!current() || !response.ok || !response.body) {
        void response.body?.cancel().catch(() => undefined)
        if (!current()) return
        if (response.status === 401) {
          // The session is over: sign out here and stop trying.
          close()
          report('offline')
          client.endSession(token)
          return
        }
        dropped()
        return
      }

      report('live')
      watch(IDLE_LIMIT_MS)
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      const parser = createSseParser(handleData)
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (!current() || done) break
          attempt = 0
          watch(IDLE_LIMIT_MS)
          parser.push(decoder.decode(value, { stream: true }))
        }
      } catch {
        // Aborted, or the connection broke; either way handled below.
      }
      if (current()) dropped()
      else void reader.cancel().catch(() => undefined)
    }

    const handleOffline = () => {
      online = false
      close()
      report('offline')
    }
    const handleOnline = () => {
      online = true
      if (stream && reported === 'live') return
      attempt = 0
      void connect()
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('offline', handleOffline)
      window.addEventListener('online', handleOnline)
    }
    report(online ? 'connecting' : 'offline')
    void connect()

    return () => {
      if (!active) return
      active = false
      close()
      if (typeof window !== 'undefined') {
        window.removeEventListener('offline', handleOffline)
        window.removeEventListener('online', handleOnline)
      }
    }
  }
}
