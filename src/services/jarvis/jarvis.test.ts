/**
 * The whole client against the in-memory reference server: every method goes
 * through a real Request and Response and must answer exactly what the demo
 * service (the reference for how the backend behaves) answers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { REALTIME_TABLES, SERVICE_KEYS } from '@/lib/types'
import type { ChangeEvent, RealtimeStatus } from '@/lib/types'
import { ServiceError } from '@/services/errors'
import type { JarvisService } from '@/services/types'

import { createJarvisBackendService } from './index'
import { BASE_URL, OWNER, createReferenceServer } from './testing/referenceServer'
import type { ReferenceServer } from './testing/referenceServer'

let server: ReferenceServer
let api: JarvisService

beforeEach(async () => {
  localStorage.clear()
  server = createReferenceServer()
  // A trailing slash on the address must not produce "//app".
  api = createJarvisBackendService(`${BASE_URL}/`, { fetch: server.fetch })
  await api.auth.signInWithPassword(OWNER.email, OWNER.password)
})

afterEach(() => {
  server.dispose()
})

async function rejection(promise: Promise<unknown>): Promise<ServiceError> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  )
  expect(error).toBeInstanceOf(ServiceError)
  return error as ServiceError
}

describe('reads', () => {
  it('answers Home the way the backend holds it', async () => {
    const { demo } = server
    const { date: _date, ...counts } = await demo.getBrief()
    expect(await api.getBrief()).toMatchObject(counts)
    expect(server.log.at(-1)).toMatch(/^GET \/app\/brief\?from=.+&to=.+$/)
    expect(await api.listApprovals()).toEqual(await demo.listApprovals())
    expect(await api.listApprovals({ status: 'pending' })).toEqual(await demo.listApprovals({ status: 'pending' }))
    expect(await api.listAlerts({ limit: 3 })).toEqual(await demo.listAlerts({ limit: 3 }))
  })

  it('answers Receptionist, with transcripts only on a single call', async () => {
    const { demo } = server
    const shops = await api.listShops()
    expect(shops).toEqual(await demo.listShops())
    const shop = shops[0]
    expect(await api.getShop(shop.id)).toEqual(await demo.getShop(shop.id))
    expect(await api.listUpcomingAppointments(shop.id)).toEqual(await demo.listUpcomingAppointments(shop.id))

    const calls = await api.listCalls(shop.id)
    expect(calls).toEqual(await demo.listCalls(shop.id))
    expect(calls.every((call) => !('transcript' in call))).toBe(true)
    expect(server.log.at(-1)).toBe(`GET /app/shops/${shop.id}/calls?filter=all`)
    const problems = await api.listCalls(shop.id, { filter: 'problems' })
    expect(problems).toEqual(await demo.listCalls(shop.id, { filter: 'problems' }))
    expect(problems.every((call) => call.outcome === 'missed' || call.outcome === 'failed')).toBe(true)

    const call = await api.getCall(calls[0].id)
    expect(call).toEqual(await demo.getCall(calls[0].id))
    expect(Array.isArray(call.transcript)).toBe(true)
  })

  it('answers Code, Memory and Settings', async () => {
    const { demo } = server
    expect(await api.listAllowedRepos()).toEqual(await demo.listAllowedRepos())
    const tasks = await api.listTasks()
    expect(tasks).toEqual(await demo.listTasks())
    expect(await api.getTask(tasks[0].id)).toEqual(tasks[0])
    expect(await api.listTaskEvents(tasks[0].id)).toEqual(await demo.listTaskEvents(tasks[0].id))
    expect(await api.listHandbookEntries()).toEqual(await demo.listHandbookEntries())
    expect(await api.listDecisions()).toEqual(await demo.listDecisions())
    expect(await api.getSettings()).toEqual(await demo.getSettings())
  })

  it('tells a missing row apart from an endpoint that is not built', async () => {
    const missing = await rejection(api.getTask('no-such-task'))
    expect(missing.code).toBe('not_found')
    expect(missing.message).toBe('Couldn’t find that task.')
    expect((await rejection(api.getShop('nope'))).code).toBe('not_found')

    server.unbuilt.add('GET /app/repos')
    const unbuilt = await rejection(api.listAllowedRepos())
    expect(unbuilt.code).toBe('not_configured')
  })
})

describe('writes', () => {
  it('creates, cancels and validates tasks on the backend', async () => {
    const repo = (await api.listAllowedRepos())[0]
    const task = await api.createTask({ repo, instructions: '  Fix the flaky login test\nIt fails on CI.  ' })
    expect(task).toMatchObject({ repo, status: 'queued', instructions: 'Fix the flaky login test\nIt fails on CI.' })
    expect((await api.listTasks())[0].id).toBe(task.id)

    const cancelled = await api.cancelTask(task.id)
    expect(cancelled.status).toBe('cancelled')
    const again = await rejection(api.cancelTask(task.id))
    expect(again).toMatchObject({ code: 'invalid', message: 'This task has already finished.' })

    const refused = await rejection(api.createTask({ repo: 'someone/else', instructions: 'Hi' }))
    expect(refused.code).toBe('invalid')
    expect(refused.message).toContain('someone/else')
  })

  it('decides approvals and marks alerts read', async () => {
    const [pending] = await api.listApprovals({ status: 'pending' })
    const decided = await api.decideApproval(pending.id, 'approved')
    expect(decided).toMatchObject({ id: pending.id, status: 'approved' })
    expect((await rejection(api.decideApproval(pending.id, 'denied'))).code).toBe('invalid')

    const unread = (await api.listAlerts()).find((alert) => !alert.read_at)
    if (unread) {
      await api.markAlertRead(unread.id)
      expect((await server.demo.listAlerts()).find((alert) => alert.id === unread.id)?.read_at).not.toBeNull()
    }
    await api.markAllAlertsRead()
    expect((await server.demo.listAlerts()).every((alert) => alert.read_at)).toBe(true)
  })

  it('saves and deletes handbook entries and decisions', async () => {
    const entry = await api.saveHandbookEntry({ title: ' Prices ', category: 'Pricing', content: 'Cut $30', tags: ['a', 'a', ' '] })
    expect(entry).toMatchObject({ title: 'Prices', tags: ['a'], notion_page_id: null })
    expect(server.log.at(-1)).toBe('POST /app/handbook')
    const edited = await api.saveHandbookEntry({ id: entry.id, title: 'Prices 2026', category: 'Pricing', content: 'Cut $35', tags: [] })
    expect(edited).toMatchObject({ id: entry.id, title: 'Prices 2026' })
    expect(server.log.at(-1)).toBe(`PUT /app/handbook/${entry.id}`)
    await api.deleteHandbookEntry(entry.id)
    expect((await rejection(api.deleteHandbookEntry(entry.id))).code).toBe('not_found')
    expect((await rejection(api.saveHandbookEntry({ title: ' ', category: '', content: '', tags: [] }))).code).toBe('invalid')

    const decision = await api.saveDecision({ title: 'Open Sundays', decision: 'Yes', rationale: ' ', decided_on: '2026-11-01', tags: [] })
    expect(decision).toMatchObject({ rationale: null, decided_on: '2026-11-01' })
    const changed = await api.saveDecision({ ...decision, id: decision.id, decision: 'No' })
    expect(changed.decision).toBe('No')
    await api.deleteDecision(decision.id)
    expect((await api.listDecisions()).some((row) => row.id === decision.id)).toBe(false)
  })

  it('patches only the settings the owner may change', async () => {
    const updated = await api.updateSettings({ notify_phone: ' +15125550100 ', allowed_repos: ['a/b', ' a/b ', 'c/d'] })
    expect(updated).toMatchObject({ notify_phone: '+15125550100', allowed_repos: ['a/b', 'c/d'] })
    expect(server.log.at(-1)).toBe('PATCH /app/settings')

    // owner_id is not editable, so nothing is sent and the settings are just read.
    await api.updateSettings({ owner_id: 'intruder' } as never)
    expect(server.log.at(-1)).toBe('GET /app/settings')
  })
})

describe('connections and voice', () => {
  it('always lists the four services in order', async () => {
    const live = await api.getConnections()
    expect(live.map((entry) => entry.service)).toEqual(SERVICE_KEYS)

    server.unbuilt.add('GET /app/connections')
    const fallback = await api.getConnections()
    expect(fallback.map((entry) => entry.service)).toEqual(SERVICE_KEYS)
    expect(fallback.every((entry) => entry.state === 'error' && entry.detail !== '')).toBe(true)
  })

  it('gets a signed voice link from the backend', async () => {
    expect((await api.getVoiceSession()).signed_url).toMatch(/^wss:\/\//)
    expect(server.log.at(-1)).toBe('POST /app/voice/session')
  })
})

describe('live updates', () => {
  it('streams changes made on the backend and stops cleanly', async () => {
    const events: ChangeEvent[] = []
    const statuses: RealtimeStatus[] = []
    const unsubscribe = api.subscribe(REALTIME_TABLES, (event) => events.push(event), (status) => statuses.push(status))
    await vi.waitFor(() => expect(statuses).toEqual(['connecting', 'live']))
    expect(server.openStreams()).toBe(1)

    const repo = (await api.listAllowedRepos())[0]
    const task = await api.createTask({ repo, instructions: 'Bump the version' })
    await vi.waitFor(() => {
      expect(events).toContainEqual({ table: 'tasks', type: 'INSERT', id: task.id, row: task })
      expect(events.some((event) => event.table === 'task_events' && event.row?.task_id === task.id)).toBe(true)
    })

    unsubscribe()
    await vi.waitFor(() => expect(server.openStreams()).toBe(0))
    const seen = events.length
    await api.cancelTask(task.id)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(events).toHaveLength(seen)
    expect(statuses).toEqual(['connecting', 'live'])
  })
})
