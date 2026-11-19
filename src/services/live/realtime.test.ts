import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChangeEvent, RealtimeStatus } from '@/lib/types'

import { fake, flush } from './testing/fakeSupabase'
import * as rows from './testing/rows'
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

const api = createLiveService()

function start(tables: Parameters<typeof api.subscribe>[0] = ['tasks', 'calls']) {
  const events: ChangeEvent[] = []
  const statuses: RealtimeStatus[] = []
  const stop = api.subscribe(
    tables,
    (event) => events.push(event),
    (status) => statuses.push(status),
  )
  return { events, statuses, stop }
}

beforeEach(() => {
  fake.reset()
  vi.useRealTimers()
})

describe('subscribe', () => {
  it('opens one channel for the tables asked for, after loading the owner’s token', async () => {
    start(['tasks', 'calls'])
    await flush()

    expect(fake.realtime.setAuth).toHaveBeenCalled()
    expect(fake.channels).toHaveLength(1)
    expect(fake.channels[0].bindings.map((binding) => binding.filter)).toEqual([
      { event: '*', schema: 'public', table: 'tasks' },
      { event: '*', schema: 'public', table: 'calls' },
    ])
  })

  it('turns inserts, updates and deletes into change events', async () => {
    const { events } = start(['tasks'])
    await flush()
    const channel = fake.channels[0]

    channel.emit('tasks', { eventType: 'INSERT', new: rows.task, old: {} })
    channel.emit('tasks', { eventType: 'UPDATE', new: { ...rows.task, status: 'done' }, old: rows.task })
    channel.emit('tasks', { eventType: 'DELETE', new: {}, old: { id: 'task-1' } })

    expect(events).toEqual([
      { table: 'tasks', type: 'INSERT', id: 'task-1', row: rows.task },
      { table: 'tasks', type: 'UPDATE', id: 'task-1', row: { ...rows.task, status: 'done' } },
      { table: 'tasks', type: 'DELETE', id: 'task-1', row: null },
    ])
  })

  it('leaves the transcript out of a changed call', async () => {
    const { events } = start(['calls'])
    await flush()
    fake.channels[0].emit('calls', { eventType: 'UPDATE', new: rows.call, old: {} })

    expect(events).toHaveLength(1)
    expect(events[0].row).toEqual(rows.callSummary)
    expect(events[0].row).not.toHaveProperty('transcript')
  })

  it('reports connecting, live, offline and live again', async () => {
    const { statuses } = start()
    await flush()
    const channel = fake.channels[0]

    expect(statuses).toEqual(['connecting'])
    channel.report('SUBSCRIBED')
    channel.report('CHANNEL_ERROR')
    channel.report('SUBSCRIBED')
    window.dispatchEvent(new Event('offline'))
    channel.report('SUBSCRIBED')
    expect(statuses).toEqual(['connecting', 'live', 'offline', 'live', 'offline', 'live'])
  })

  it('replaces a channel the server closed', async () => {
    vi.useFakeTimers()
    const { statuses } = start()
    await vi.advanceTimersByTimeAsync(0)
    fake.channels[0].report('SUBSCRIBED')
    fake.channels[0].report('CLOSED')
    expect(statuses.at(-1)).toBe('offline')

    await vi.advanceTimersByTimeAsync(1_000)
    expect(fake.channels).toHaveLength(2)
    fake.channels[1].report('SUBSCRIBED')
    expect(statuses.at(-1)).toBe('live')
  })

  it('removes its channel and stops listening when unsubscribed', async () => {
    const { events, statuses, stop } = start(['tasks'])
    await flush()
    const channel = fake.channels[0]
    stop()

    expect(fake.removeChannel).toHaveBeenCalledWith(channel)
    channel.emit('tasks', { eventType: 'INSERT', new: rows.task, old: {} })
    window.dispatchEvent(new Event('offline'))
    expect(events).toEqual([])
    expect(statuses).toEqual(['connecting'])
  })

  it('gives every subscription its own channel', async () => {
    start(['tasks'])
    start(['tasks'])
    await flush()
    expect(fake.channels).toHaveLength(2)
    expect(fake.channels[0].name).not.toBe(fake.channels[1].name)
  })

  it('survives subscribe, unsubscribe, subscribe in one go, as StrictMode does', async () => {
    const first = start(['alerts'])
    first.stop()
    const second = start(['alerts'])
    await flush()

    // The first one stopped before its token loaded, so it never opened a channel.
    expect(fake.channels).toHaveLength(1)
    fake.channels[0].emit('alerts', { eventType: 'INSERT', new: rows.alert, old: {} })
    expect(first.events).toEqual([])
    expect(second.events).toHaveLength(1)
  })
})
