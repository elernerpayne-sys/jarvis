/**
 * Live changes from Postgres. One channel per subscription carries inserts,
 * updates and deletes for the tables asked for, and reports whether that
 * channel is currently connected.
 */
import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js'
import type { RealtimeChannel, RealtimePostgresChangesPayload, SupabaseClient } from '@supabase/supabase-js'

import type { ChangeEvent, RealtimeStatus, RealtimeTable } from '@/lib/types'
import type { JarvisService } from '@/services/types'

import { getClient } from './client'

type Row = Record<string, unknown>

/** Waits between attempts to replace a channel the server closed. */
const REOPEN_DELAYS_MS = [1_000, 2_000, 5_000, 10_000]

/** Channel names must be unique: supabase-js hands back the same channel for the same name. */
let channelCount = 0

function rowId(row: unknown): string | null {
  if (typeof row !== 'object' || row === null || !('id' in row)) return null
  const { id } = row
  return typeof id === 'string' || typeof id === 'number' ? String(id) : null
}

/** A call arrives with every column. Lists hold call summaries, so the transcript stays out. */
function withoutTranscript(row: Row): Row {
  const summary = { ...row }
  delete summary.transcript
  return summary
}

/** Null when the change does not say which row it is about. */
export function toChangeEvent(table: RealtimeTable, payload: RealtimePostgresChangesPayload<Row>): ChangeEvent | null {
  // Deletes only carry the old row (often just its key); everything else carries the new one.
  const id = payload.eventType === 'DELETE' ? rowId(payload.old) : rowId(payload.new)
  if (id === null) return null
  let row: Row | null = null
  if (payload.eventType !== 'DELETE') row = table === 'calls' ? withoutTranscript(payload.new) : payload.new
  // The row is whatever Postgres holds for this table, which is what the
  // types in lib/types.ts describe; TypeScript cannot see that from here.
  return { table, type: payload.eventType, id, row } as ChangeEvent
}

export const subscribe: JarvisService['subscribe'] = (tables, onChange, onStatus) => {
  const wanted = [...new Set(tables)]
  let active = true
  let client: SupabaseClient | null = null
  let channel: RealtimeChannel | null = null
  let link: 'joining' | 'joined' | 'lost' = 'joining'
  let browserOnline = typeof navigator === 'undefined' || navigator.onLine !== false
  let reported: RealtimeStatus | null = null
  let reopenTimer: ReturnType<typeof setTimeout> | undefined
  let closures = 0

  function report() {
    let status: RealtimeStatus = 'offline'
    if (browserOnline && link === 'joined') status = 'live'
    else if (browserOnline && link === 'joining') status = 'connecting'
    if (!active || status === reported) return
    reported = status
    onStatus?.(status)
  }

  function open(source: SupabaseClient) {
    channelCount += 1
    let next = source.channel(`jarvis-changes-${channelCount}`)
    for (const table of wanted) {
      next = next.on<Row>('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
        if (!active) return
        const event = toChangeEvent(table, payload)
        if (event) onChange(event)
      })
    }
    channel = next
    next.subscribe((state) => {
      // A channel that was removed or replaced still announces its own closing.
      if (!active || channel !== next) return
      if (state === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
        link = 'joined'
        // Being subscribed is better evidence than navigator.onLine, which some devices get wrong.
        browserOnline = true
        closures = 0
      } else {
        link = 'lost'
        // After an error or a timeout supabase-js rejoins the same channel by
        // itself. A closed channel is gone for good (the server does this
        // when a token expires while the phone sleeps), so it is replaced.
        if (state === REALTIME_SUBSCRIBE_STATES.CLOSED) {
          channel = null
          const delay = REOPEN_DELAYS_MS[Math.min(closures, REOPEN_DELAYS_MS.length - 1)]
          closures += 1
          reopenTimer = setTimeout(() => void connect(), delay)
        }
      }
      report()
    })
  }

  async function connect() {
    if (!active) return
    let source: SupabaseClient
    try {
      source = getClient()
    } catch {
      // Supabase is not configured; there is nothing to connect to.
      link = 'lost'
      report()
      return
    }
    client = source
    try {
      // The join message is built the moment the channel subscribes. Loading
      // the token first makes it join as the signed-in owner, so row-level
      // security lets rows through. After that supabase-js keeps the token on
      // the channel current through every refresh.
      await source.realtime.setAuth()
    } catch {
      // The token could not be loaded just now. supabase-js sends it with a
      // later heartbeat, so joining is still the right thing to do.
    }
    // Unsubscribed while the token was loading (React StrictMode does this on
    // every mount): there is nothing to open and nothing to clean up.
    if (active) open(source)
  }

  const handleOffline = () => {
    browserOnline = false
    report()
  }
  const handleOnline = () => {
    browserOnline = true
    report()
  }

  reported = 'connecting'
  onStatus?.('connecting')
  report()
  if (typeof window !== 'undefined') {
    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)
  }
  void connect()

  return () => {
    if (!active) return
    active = false
    clearTimeout(reopenTimer)
    if (typeof window !== 'undefined') {
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
    }
    const current = channel
    channel = null
    if (client && current) void client.removeChannel(current).catch(() => undefined)
  }
}
