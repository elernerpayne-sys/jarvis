import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { dayBounds } from '@/lib/format'
import type { CallSummary, ChangeEvent, RealtimeStatus } from '@/lib/types'
import { REALTIME_TABLES } from '@/lib/types'

import { createDemoService } from './index'
import type { DemoOptions, DemoService } from './index'
import { readScenario } from './scenario'

// Thursday, 3:30 PM local time: the shops are open and well into the day.
const NOW = new Date(2026, 10, 19, 15, 30)

const services: DemoService[] = []

function demo(options: DemoOptions = {}): DemoService {
  const service = createDemoService({ latency: false, simulate: false, scenario: null, seed: 7, ...options })
  services.push(service)
  return service
}

function isToday(call: CallSummary, now = new Date()): boolean {
  const { from, to } = dayBounds(now)
  const at = new Date(call.started_at).getTime()
  return at >= from.getTime() && at < to.getTime()
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW })
})

afterEach(() => {
  for (const service of services.splice(0)) service.dispose()
  vi.useRealTimers()
})

describe('sample data', () => {
  it('counts the brief and each shop from the same calls the lists show', async () => {
    const api = demo()
    const [brief, shops, tasks] = await Promise.all([api.getBrief(), api.listShops(), api.listTasks()])

    let answered = 0
    let booked = 0
    let problems = 0
    for (const shop of shops) {
      const today = (await api.listCalls(shop.id)).filter((call) => isToday(call))
      const shopProblems = today.filter((call) => call.outcome === 'missed' || call.outcome === 'failed').length
      const shopBooked = today.filter((call) => call.outcome === 'booked').length
      expect(shop.calls_today).toBe(today.length)
      expect(shop.bookings_today).toBe(shopBooked)
      expect(shop.missed_today).toBe(shopProblems)
      answered += today.length - shopProblems
      booked += shopBooked
      problems += shopProblems
    }

    const { from, to } = dayBounds(NOW)
    const finishedToday = tasks.filter((task) => {
      const at = task.finished_at ? new Date(task.finished_at).getTime() : NaN
      return task.status === 'done' && at >= from.getTime() && at < to.getTime()
    })
    expect(brief).toEqual({
      date: '2026-11-19',
      calls_answered: answered,
      bookings_made: booked,
      missed_calls: problems,
      tasks_finished: finishedToday.length,
    })
    expect(brief.missed_calls).toBeGreaterThanOrEqual(3)
    expect(brief.tasks_finished).toBeGreaterThanOrEqual(1)
  })

  it('has three shops, two answering, and every outcome in the call log', async () => {
    const api = demo()
    const shops = await api.listShops()
    expect(shops).toHaveLength(3)
    expect(shops.filter((shop) => shop.status === 'active')).toHaveLength(2)

    const calls = (await Promise.all(shops.map((shop) => api.listCalls(shop.id)))).flat()
    const outcomes = new Set(calls.map((call) => call.outcome))
    expect([...outcomes].sort()).toEqual(['answered', 'booked', 'failed', 'message', 'missed', 'transferred'])
    const today = calls.filter((call) => isToday(call))
    expect(today.filter((call) => call.outcome === 'missed').length).toBeGreaterThanOrEqual(2)
    expect(today.filter((call) => call.outcome === 'failed').length).toBeGreaterThanOrEqual(1)
  })

  it.each([
    ['just after midnight', new Date(2026, 10, 19, 0, 20)],
    ['before opening', new Date(2026, 10, 19, 7, 45)],
    ['late evening', new Date(2026, 10, 22, 21, 40)],
  ])('has calls today and none in the future %s', async (_when, now) => {
    vi.setSystemTime(now)
    const api = demo()
    const shops = await api.listShops()
    const calls = (await Promise.all(shops.map((shop) => api.listCalls(shop.id)))).flat()
    expect(calls.filter((call) => isToday(call, now)).length).toBeGreaterThan(0)
    expect(calls.every((call) => new Date(call.started_at).getTime() <= now.getTime())).toBe(true)
  })

  it('keeps only missed and failed calls under the problems filter, newest first', async () => {
    const api = demo()
    const [shop] = await api.listShops()
    const all = await api.listCalls(shop.id)
    const problems = await api.listCalls(shop.id, { filter: 'problems' })

    expect(problems.length).toBeGreaterThan(0)
    expect(problems.every((call) => call.outcome === 'missed' || call.outcome === 'failed')).toBe(true)
    expect(problems).toHaveLength(all.filter((call) => ['missed', 'failed'].includes(call.outcome)).length)
    const times = all.map((call) => call.started_at)
    expect(times).toEqual([...times].sort().reverse())
  })

  it('gives every booked call its appointment, and transcripts that fit the outcome', async () => {
    const api = demo()
    const shops = await api.listShops()
    for (const shop of shops) {
      const calls = await api.listCalls(shop.id)
      // Every appointment for the shop, past and upcoming, through the calls' own ids.
      for (const summary of calls.filter((call) => call.outcome === 'booked').slice(0, 6)) {
        const call = await api.getCall(summary.id)
        expect(call.transcript.length).toBeGreaterThan(2)
        expect(call.transcript[0].text).toContain(shop.name)
      }
      for (const summary of calls.filter((call) => call.outcome === 'missed').slice(0, 3)) {
        const call = await api.getCall(summary.id)
        expect(call.transcript).toEqual([])
        expect(call.duration_seconds).toBeLessThanOrEqual(8)
      }
    }
  })

  it('links every booked call to an appointment', async () => {
    // Upcoming appointments only show from now on, so look from a week back.
    vi.setSystemTime(NOW)
    const api = demo()
    const shops = await api.listShops()
    const booked = (await Promise.all(shops.map((shop) => api.listCalls(shop.id))))
      .flat()
      .filter((call) => call.outcome === 'booked')

    vi.setSystemTime(new Date(NOW.getTime() - 8 * 24 * 3600 * 1000))
    const appointments = (await Promise.all(shops.map((shop) => api.listUpcomingAppointments(shop.id)))).flat()
    // Cancelled ones are left out of the list, so allow for the odd one.
    const linked = new Set(appointments.map((appointment) => appointment.call_id))
    const missing = booked.filter((call) => !linked.has(call.id))
    expect(missing.length).toBeLessThanOrEqual(Math.ceil(booked.length * 0.1))
  })

  it('lists upcoming appointments soonest first, without cancelled ones', async () => {
    const api = demo()
    const [shop] = await api.listShops()
    const upcoming = await api.listUpcomingAppointments(shop.id)
    expect(upcoming.length).toBeGreaterThan(5)
    expect(upcoming.every((appointment) => appointment.status !== 'cancelled')).toBe(true)
    expect(upcoming.every((appointment) => new Date(appointment.starts_at) >= NOW)).toBe(true)
    const times = upcoming.map((appointment) => appointment.starts_at)
    expect(times).toEqual([...times].sort())
    expect(shop.next_appointment_at).toBe(
      upcoming.find((appointment) => ['booked', 'confirmed'].includes(appointment.status))?.starts_at,
    )
  })

  it('covers every task status and pending approval kind', async () => {
    const api = demo()
    const tasks = await api.listTasks()
    expect(new Set(tasks.map((task) => task.status))).toEqual(
      new Set(['queued', 'running', 'needs_approval', 'done', 'failed', 'cancelled']),
    )
    const pending = await api.listApprovals({ status: 'pending' })
    expect(new Set(pending.map((approval) => approval.kind))).toEqual(new Set(['code', 'receptionist', 'spend']))
    const alerts = await api.listAlerts()
    expect(alerts.filter((alert) => !alert.read_at).length).toBeGreaterThanOrEqual(3)
    expect(alerts.slice(0, 3).every((alert) => !alert.read_at)).toBe(true)
    expect((await api.listAlerts({ limit: 2 })).length).toBe(2)
  })

  it('builds the same data from the same seed', async () => {
    const first = demo({ seed: 42 })
    const second = demo({ seed: 42 })
    const other = demo({ seed: 43 })
    const [shop] = await first.listShops()
    const calls = await first.listCalls(shop.id)
    expect(await second.listCalls(shop.id)).toEqual(calls)
    expect(await other.listCalls(shop.id)).not.toEqual(calls)
  })

  it('returns copies that cannot change the data', async () => {
    const api = demo()
    const [task] = await api.listTasks()
    task.title = 'Changed'
    expect((await api.getTask(task.id)).title).not.toBe('Changed')
  })
})

describe('lookups', () => {
  it('rejects unknown ids with not_found', async () => {
    const api = demo()
    await expect(api.getCall('nope')).rejects.toMatchObject({ code: 'not_found' })
    await expect(api.getTask('nope')).rejects.toMatchObject({ code: 'not_found' })
    await expect(api.getShop('nope')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('says voice is not configured in demo mode', async () => {
    await expect(demo().getVoiceSession()).rejects.toMatchObject({ code: 'not_configured' })
  })

  it('reports one connection per service, in order', async () => {
    const connections = await demo().getConnections()
    expect(connections.map((connection) => [connection.service, connection.state])).toEqual([
      ['elevenlabs', 'connected'],
      ['twilio', 'connected'],
      ['notion', 'not_configured'],
      ['jarvis', 'connected'],
    ])
  })

  it('is always signed in as the demo owner', async () => {
    const api = demo()
    expect(await api.auth.getUser()).toEqual({ id: 'demo-owner', email: 'owner@jarvis.demo' })
    await api.auth.signOut()
    expect(await api.auth.getUser()).not.toBeNull()
  })
})

describe('tasks', () => {
  it('checks the repo and instructions like the real backend', async () => {
    const api = demo()
    const ok = 'Fix the footer'
    await expect(api.createTask({ repo: 'someone/else', instructions: ok })).rejects.toMatchObject({ code: 'invalid' })
    await expect(api.createTask({ repo: 'jarvis-ops/booking-site', instructions: '   ' })).rejects.toMatchObject({
      code: 'invalid',
    })
    await expect(
      api.createTask({ repo: 'jarvis-ops/booking-site', instructions: 'x'.repeat(8001) }),
    ).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('8,000') })
  })

  it('runs a new task from queued to done, telling subscribers along the way', async () => {
    const api = demo({ simulate: true })
    const events: ChangeEvent[] = []
    api.subscribe(REALTIME_TABLES, (event) => events.push(event))

    const task = await api.createTask({
      repo: 'jarvis-ops/shop-dashboard',
      instructions: 'Show this week’s bookings per barber\nAs a small table on the shop page.',
    })
    expect(task).toMatchObject({ status: 'queued', title: 'Show this week’s bookings per barber' })

    await vi.advanceTimersByTimeAsync(2100)
    expect((await api.getTask(task.id)).status).toBe('running')

    await vi.advanceTimersByTimeAsync(40_000)
    const done = await api.getTask(task.id)
    expect(done).toMatchObject({ status: 'done' })
    expect(done.branch).toMatch(/^jarvis\//)
    expect(done.pr_url).toContain('jarvis-ops/shop-dashboard')
    expect(done.result_summary).toBeTruthy()
    expect(done.finished_at).toBeTruthy()

    const log = await api.listTaskEvents(task.id)
    expect(log[0].message).toBe('Queued')
    expect(log.some((event) => event.message.includes('jarvis-ops/shop-dashboard'))).toBe(true)
    expect(log.at(-1)?.message).toBe('Done')

    const taskUpdates = events.filter((event) => event.table === 'tasks' && event.id === task.id)
    expect(taskUpdates.map((event) => event.type)[0]).toBe('INSERT')
    expect(events.some((event) => event.table === 'alerts' && event.row?.task_id === task.id)).toBe(true)
    const alerts = await api.listAlerts()
    expect(alerts.find((alert) => alert.task_id === task.id)?.type).toBe('task_done')
  })

  it('carries on after an approval and finishes', async () => {
    const api = demo({ simulate: true })
    const approval = (await api.listApprovals({ status: 'pending' })).find(
      (item) => item.kind === 'code' && item.task_id,
    )
    if (!approval?.task_id) throw new Error('Expected a pending code approval.')
    expect((await api.getTask(approval.task_id)).status).toBe('needs_approval')

    const decided = await api.decideApproval(approval.id, 'approved')
    expect(decided.status).toBe('approved')
    expect((await api.getTask(approval.task_id)).status).toBe('running')

    await vi.advanceTimersByTimeAsync(15_000)
    const task = await api.getTask(approval.task_id)
    expect(task.status).toBe('done')
    expect(task.pr_url).toBeTruthy()
    const log = (await api.listTaskEvents(task.id)).map((event) => event.message)
    expect(log).toContain('Approved by you')
    await expect(api.decideApproval(approval.id, 'denied')).rejects.toMatchObject({ code: 'invalid' })
  })

  it('cancels the task when its approval is denied', async () => {
    const api = demo({ simulate: true })
    const approval = (await api.listApprovals({ status: 'pending' })).find((item) => item.task_id)
    if (!approval?.task_id) throw new Error('Expected a pending code approval.')
    await api.decideApproval(approval.id, 'denied')
    const task = await api.getTask(approval.task_id)
    expect(task.status).toBe('cancelled')
    expect(task.finished_at).toBeTruthy()
    expect((await api.listTaskEvents(task.id)).at(-1)?.message).toBe('Denied by you')
  })

  it('asks for approval when the running task gets there', async () => {
    const api = demo({ simulate: true })
    const running = (await api.listTasks()).find((task) => task.status === 'running')
    if (!running) throw new Error('Expected a running task.')
    await vi.advanceTimersByTimeAsync(80_000)
    expect((await api.getTask(running.id)).status).toBe('needs_approval')
    const pending = await api.listApprovals({ status: 'pending' })
    expect(pending.some((approval) => approval.task_id === running.id)).toBe(true)
    const alerts = await api.listAlerts()
    expect(alerts.some((alert) => alert.type === 'approval_needed' && alert.task_id === running.id)).toBe(true)
  })

  it('cancelling stops the run and expires its approvals', async () => {
    const api = demo({ simulate: true })
    const tasks = await api.listTasks()
    const running = tasks.find((task) => task.status === 'running')
    const waiting = tasks.find((task) => task.status === 'needs_approval')
    if (!running || !waiting) throw new Error('Expected a running and a waiting task.')

    const cancelled = await api.cancelTask(running.id)
    expect(cancelled).toMatchObject({ status: 'cancelled' })
    expect(cancelled.finished_at).toBeTruthy()
    const logLength = (await api.listTaskEvents(running.id)).length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(await api.listTaskEvents(running.id)).toHaveLength(logLength)
    expect((await api.getTask(running.id)).status).toBe('cancelled')

    await api.cancelTask(waiting.id)
    const approvals = await api.listApprovals()
    expect(approvals.filter((approval) => approval.task_id === waiting.id).map((a) => a.status)).toEqual(['expired'])
    expect((await api.listTaskEvents(waiting.id)).at(-1)?.message).toBe('Cancelled by you')

    await expect(api.cancelTask(waiting.id)).rejects.toMatchObject({ code: 'invalid' })
  })
})

describe('memory and settings', () => {
  it('creates, edits and deletes handbook entries', async () => {
    const api = demo()
    const before = await api.listHandbookEntries()
    expect(before.length).toBeGreaterThanOrEqual(9)

    const created = await api.saveHandbookEntry({
      title: ' Gift cards ',
      category: 'Policies',
      content: 'Sold at the counter in $25 steps.',
      tags: ['gift cards', ' ', 'gift cards'],
    })
    expect(created).toMatchObject({ title: 'Gift cards', tags: ['gift cards'] })
    expect((await api.listHandbookEntries())[0].id).toBe(created.id)

    vi.advanceTimersByTime(1000)
    const edited = await api.saveHandbookEntry({ ...created, content: 'Sold at the counter and online.' })
    expect(edited.content).toBe('Sold at the counter and online.')
    expect(edited.updated_at > created.updated_at).toBe(true)

    await api.deleteHandbookEntry(created.id)
    expect(await api.listHandbookEntries()).toHaveLength(before.length)
    await expect(api.deleteHandbookEntry(created.id)).rejects.toMatchObject({ code: 'not_found' })
    await expect(api.saveHandbookEntry({ title: '', category: '', content: '', tags: [] })).rejects.toMatchObject({
      code: 'invalid',
    })
  })

  it('creates, edits and deletes decisions, newest decision date first', async () => {
    const api = demo()
    const before = await api.listDecisions()
    expect(before.length).toBeGreaterThanOrEqual(7)
    const dates = before.map((decision) => decision.decided_on)
    expect(dates).toEqual([...dates].sort().reverse())

    const created = await api.saveDecision({
      title: 'Close early on Christmas Eve',
      decision: 'All shops close at 2 PM on December 24.',
      rationale: '',
      decided_on: '2026-11-19',
      tags: [],
    })
    expect(created.rationale).toBeNull()
    const edited = await api.saveDecision({ ...created, rationale: 'Barbers asked for the afternoon.' })
    expect(edited.rationale).toBe('Barbers asked for the afternoon.')
    await expect(api.saveDecision({ ...created, decided_on: 'soon' })).rejects.toMatchObject({ code: 'invalid' })
    await api.deleteDecision(created.id)
    expect(await api.listDecisions()).toHaveLength(before.length)
  })

  it('merges a settings patch', async () => {
    const api = demo()
    const before = await api.getSettings()
    expect(before).toMatchObject({ quiet_hours_enabled: true, quiet_hours_start: '22:00', notify_phone: '+15125550100' })

    const after = await api.updateSettings({
      quiet_hours_enabled: false,
      notification_prefs: { ...before.notification_prefs, task_done: 'text' },
    })
    expect(after).toMatchObject({ quiet_hours_enabled: false, quiet_hours_start: '22:00', notify_phone: '+15125550100' })
    expect(after.notification_prefs.task_done).toBe('text')
    expect(await api.getSettings()).toEqual(after)
  })

  it('marks one alert or all of them read', async () => {
    const api = demo()
    const unread = (await api.listAlerts()).filter((alert) => !alert.read_at)
    expect(unread.length).toBeGreaterThan(1)

    await api.markAlertRead(unread[0].id)
    const afterOne = await api.listAlerts()
    expect(afterOne.find((alert) => alert.id === unread[0].id)?.read_at).toBeTruthy()
    expect(afterOne.filter((alert) => !alert.read_at)).toHaveLength(unread.length - 1)

    await api.markAllAlertsRead()
    expect((await api.listAlerts()).every((alert) => alert.read_at)).toBe(true)
  })
})

describe('realtime', () => {
  it('reports connecting then live, and stops after unsubscribe', async () => {
    const api = demo()
    const statuses: RealtimeStatus[] = []
    const events: ChangeEvent[] = []
    const unsubscribe = api.subscribe(['alerts'], (event) => events.push(event), (status) => statuses.push(status))
    expect(statuses).toEqual([])
    await vi.advanceTimersByTimeAsync(0)
    expect(statuses).toEqual(['connecting', 'live'])

    const [alert] = (await api.listAlerts()).filter((item) => !item.read_at)
    await api.markAlertRead(alert.id)
    expect(events).toEqual([expect.objectContaining({ table: 'alerts', type: 'UPDATE', id: alert.id })])

    unsubscribe()
    await api.markAllAlertsRead()
    expect(events).toHaveLength(1)
  })

  it('only delivers the tables asked for', async () => {
    const api = demo()
    const events: ChangeEvent[] = []
    api.subscribe(['calls'], (event) => events.push(event))
    await api.markAllAlertsRead()
    expect(events).toEqual([])
  })

  it('brings in new calls while the app is open', async () => {
    const api = demo({ simulate: true })
    const events: ChangeEvent[] = []
    api.subscribe(['calls'], (event) => events.push(event))
    await vi.advanceTimersByTimeAsync(3 * 90_000)
    expect(events.filter((event) => event.type === 'INSERT').length).toBeGreaterThanOrEqual(3)
    expect(events.every((event) => event.row && !('transcript' in event.row))).toBe(true)
  })

  it('leaves no timers behind after dispose', async () => {
    const api = demo({ simulate: true })
    api.subscribe(REALTIME_TABLES, () => {})
    await api.createTask({ repo: 'jarvis-ops/booking-site', instructions: 'Tidy the footer links' })
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    api.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('scenarios', () => {
  it('empty: every list is empty and the brief is zeros, settings still load', async () => {
    const api = demo({ scenario: 'empty', simulate: true })
    expect(await api.listShops()).toEqual([])
    expect(await api.listTasks()).toEqual([])
    expect(await api.listApprovals()).toEqual([])
    expect(await api.listAlerts()).toEqual([])
    expect(await api.listHandbookEntries()).toEqual([])
    expect(await api.listDecisions()).toEqual([])
    expect(await api.getBrief()).toMatchObject({ calls_answered: 0, bookings_made: 0, missed_calls: 0, tasks_finished: 0 })
    expect((await api.getSettings()).allowed_repos).toHaveLength(4)
    expect(await api.getConnections()).toHaveLength(4)
  })

  it('error: reads reject with a network error the owner can read', async () => {
    const api = demo({ scenario: 'error' })
    await expect(api.listShops()).rejects.toMatchObject({
      code: 'network',
      message: 'Couldn’t reach Jarvis. Check your connection and try again.',
    })
    await expect(api.getBrief()).rejects.toMatchObject({ code: 'network' })
    await expect(api.getSettings()).rejects.toMatchObject({ code: 'network' })
  })

  it('slow: reads take about two and a half seconds', async () => {
    const api = createDemoService({ scenario: 'slow', simulate: false, seed: 7 })
    services.push(api)
    let settled = false
    void api.listTasks().then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(2000)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(settled).toBe(true)
  })

  it('reads the scenario from the address and remembers it for the tab', () => {
    window.history.replaceState(null, '', '/?demo=empty')
    expect(readScenario()).toBe('empty')
    window.history.replaceState(null, '', '/receptionist')
    expect(readScenario()).toBe('empty')
    window.history.replaceState(null, '', '/?demo=off')
    expect(readScenario()).toBeNull()
    window.history.replaceState(null, '', '/')
    expect(readScenario()).toBeNull()
  })
})
