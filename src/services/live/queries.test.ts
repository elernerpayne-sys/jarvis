import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { HandbookEntryInput, SettingsPatch } from '@/lib/types'
import { ServiceError } from '@/services/errors'

import { fake } from './testing/fakeSupabase'
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

function columnsOf(query: { columns?: string }): string[] {
  return (query.columns ?? '').split(',')
}

async function failureOf(promise: Promise<unknown>): Promise<ServiceError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(ServiceError)
    return error as ServiceError
  }
  throw new Error('Expected it to reject.')
}

beforeEach(() => fake.reset())

describe('home', () => {
  it('counts today through get_brief with the bounds of the local day', async () => {
    fake.reply({ data: [{ calls_answered: 7, bookings_made: 3, missed_calls: 1, tasks_finished: 2 }] })
    const brief = await api.getBrief()

    const query = fake.onlyQuery()
    expect(query.source).toBe('rpc:get_brief')
    const args = query.args as { p_from: string; p_to: string }
    expect(new Date(args.p_from).getTime()).toBeLessThan(new Date(args.p_to).getTime())
    expect(brief).toMatchObject({ calls_answered: 7, bookings_made: 3, missed_calls: 1, tasks_finished: 2 })
  })

  it('lists approvals newest first, filtered by status when asked', async () => {
    fake.reply({ data: [rows.approval] })
    expect(await api.listApprovals({ status: 'pending' })).toEqual([rows.approval])

    const query = fake.onlyQuery()
    expect(query.source).toBe('approvals')
    expect(query.filters).toEqual([['eq', 'status', 'pending']])
    expect(query.order).toEqual([['requested_at', 'desc']])
    expect(query.limit).toBe(200)
  })

  it('lists alerts newest first with the limit asked for', async () => {
    fake.reply({ data: [rows.alert] })
    expect(await api.listAlerts({ limit: 20 })).toEqual([rows.alert])
    expect(fake.onlyQuery()).toMatchObject({ source: 'alerts', order: [['created_at', 'desc']], limit: 20 })
  })

  it('marks one alert read without touching an alert that was already read', async () => {
    await api.markAlertRead('alert-1')
    const query = fake.onlyQuery()
    expect(query).toMatchObject({ source: 'alerts', action: 'update' })
    expect(Object.keys(query.values as object)).toEqual(['read_at'])
    expect(query.filters).toEqual([
      ['eq', 'id', 'alert-1'],
      ['is', 'read_at', null],
    ])
  })

  it('marks every unread alert read', async () => {
    await api.markAllAlertsRead()
    const query = fake.onlyQuery()
    expect(query).toMatchObject({ source: 'alerts', action: 'update', filters: [['is', 'read_at', null]] })
    expect(Object.keys(query.values as object)).toEqual(['read_at'])
  })
})

describe('receptionist', () => {
  it('lists shops through get_shop_summaries', async () => {
    fake.reply({ data: [rows.shop] })
    expect(await api.listShops()).toEqual([rows.shop])
    const query = fake.onlyQuery()
    expect(query.source).toBe('rpc:get_shop_summaries')
    expect(query.args).toMatchObject({ p_from: expect.any(String), p_to: expect.any(String) })
  })

  it('reads one shop from the same function, and says when it is not there', async () => {
    fake.reply({ data: rows.shop })
    expect(await api.getShop('shop-1')).toEqual(rows.shop)
    expect(fake.onlyQuery()).toMatchObject({ source: 'rpc:get_shop_summaries', filters: [['eq', 'id', 'shop-1']] })

    fake.reply({ data: null })
    expect(await failureOf(api.getShop('gone'))).toMatchObject({ code: 'not_found', message: 'Couldn’t find that shop.' })
  })

  it('lists upcoming appointments soonest first, leaving out cancelled ones', async () => {
    fake.reply({ data: [rows.appointment] })
    expect(await api.listUpcomingAppointments('shop-1')).toEqual([rows.appointment])
    const query = fake.onlyQuery()
    expect(query.source).toBe('appointments')
    expect(query.filters).toEqual([
      ['eq', 'shop_id', 'shop-1'],
      ['gte', 'starts_at', expect.any(String)],
      ['neq', 'status', 'cancelled'],
    ])
    expect(query.order).toEqual([['starts_at', 'asc']])
  })

  it('lists calls newest first without their transcripts', async () => {
    fake.reply({ data: [rows.callSummary] })
    expect(await api.listCalls('shop-1')).toEqual([rows.callSummary])
    const query = fake.onlyQuery()
    expect(query.source).toBe('calls')
    expect(columnsOf(query)).not.toContain('transcript')
    expect(columnsOf(query)).toEqual(expect.arrayContaining(Object.keys(rows.callSummary)))
    expect(query.filters).toEqual([['eq', 'shop_id', 'shop-1']])
    expect(query.order).toEqual([['started_at', 'desc']])
    expect(query.limit).toBe(200)
  })

  it('keeps only missed and failed calls for the problems filter', async () => {
    await api.listCalls('shop-1', { filter: 'problems' })
    expect(fake.onlyQuery().filters).toContainEqual(['in', 'outcome', ['missed', 'failed']])
  })

  it('reads one call with its transcript', async () => {
    fake.reply({ data: rows.call })
    expect(await api.getCall('call-1')).toEqual(rows.call)
    expect(columnsOf(fake.onlyQuery())).toContain('transcript')

    fake.reply({ data: null })
    expect(await failureOf(api.getCall('gone'))).toMatchObject({ code: 'not_found' })
  })
})

describe('code', () => {
  it('reads the allowed repos from settings', async () => {
    fake.reply({ data: { allowed_repos: ['a/b'] } })
    expect(await api.listAllowedRepos()).toEqual(['a/b'])
    expect(fake.onlyQuery()).toMatchObject({ source: 'settings', columns: 'allowed_repos' })
  })

  it('lists the 200 newest tasks', async () => {
    fake.reply({ data: [rows.task] })
    expect(await api.listTasks()).toEqual([rows.task])
    expect(fake.onlyQuery()).toMatchObject({ source: 'tasks', order: [['created_at', 'desc']], limit: 200 })
  })

  it('says when a task is not there', async () => {
    fake.reply({ data: null })
    expect(await failureOf(api.getTask('gone'))).toMatchObject({ code: 'not_found', message: 'Couldn’t find that task.' })
  })

  it('returns the newest 500 log lines, oldest first', async () => {
    const newest = rows.taskEvent('e2', 'Second', '2026-11-12T18:02:00.000Z')
    const oldest = rows.taskEvent('e1', 'First', '2026-11-12T18:01:00.000Z')
    fake.reply({ data: [newest, oldest] })

    expect(await api.listTaskEvents('task-1')).toEqual([oldest, newest])
    const query = fake.onlyQuery()
    expect(query).toMatchObject({ source: 'task_events', filters: [['eq', 'task_id', 'task-1']], limit: 500 })
    expect(query.order[0]).toEqual(['created_at', 'desc'])
  })
})

describe('memory', () => {
  const input: HandbookEntryInput = { title: '  Opening hours ', category: ' Shops ', content: ' 9 to 7 ', tags: [' hours ', '', 'hours'] }

  it('inserts a handbook entry that has no id, trimmed and without notion_page_id', async () => {
    fake.reply({ data: rows.handbookEntry })
    expect(await api.saveHandbookEntry(input)).toEqual(rows.handbookEntry)
    const query = fake.onlyQuery()
    expect(query).toMatchObject({ source: 'handbook_entries', action: 'insert', shape: 'single' })
    expect(query.values).toEqual({ title: 'Opening hours', category: 'Shops', content: '9 to 7', tags: ['hours'] })
    expect(query.filters).toEqual([])
  })

  it('updates a handbook entry that has an id', async () => {
    fake.reply({ data: rows.handbookEntry })
    await api.saveHandbookEntry({ ...input, id: 'entry-1' })
    const query = fake.onlyQuery()
    expect(query).toMatchObject({ action: 'update', filters: [['eq', 'id', 'entry-1']] })
    expect(query.values).not.toHaveProperty('notion_page_id')
    expect(query.values).not.toHaveProperty('id')
  })

  it('refuses an entry without a title before asking the database', async () => {
    expect(await failureOf(api.saveHandbookEntry({ ...input, title: '  ' }))).toMatchObject({ code: 'invalid' })
    expect(fake.queries).toHaveLength(0)
  })

  it('saves a decision, empty rationale as null', async () => {
    fake.reply({ data: rows.decision })
    await api.saveDecision({ title: ' Raise prices ', decision: ' $40 ', rationale: ' ', decided_on: '2026-11-01', tags: [] })
    expect(fake.onlyQuery()).toMatchObject({
      source: 'decisions',
      action: 'insert',
      values: { title: 'Raise prices', decision: '$40', rationale: null, decided_on: '2026-11-01', tags: [] },
    })
  })

  it('lists decisions by decision date, newest first', async () => {
    await api.listDecisions()
    expect(fake.onlyQuery().order[0]).toEqual(['decided_on', 'desc'])
  })

  it('deletes by id', async () => {
    await api.deleteDecision('decision-1')
    expect(fake.onlyQuery()).toMatchObject({ source: 'decisions', action: 'delete', filters: [['eq', 'id', 'decision-1']] })
  })
})

describe('settings', () => {
  it('updates only the fields given, never owner_id, and returns the saved row', async () => {
    fake.reply({ data: rows.settings })
    const patch = { quiet_hours_enabled: false, owner_id: 'someone-else', id: 'x' } as SettingsPatch
    expect(await api.updateSettings(patch)).toEqual(rows.settings)

    const query = fake.onlyQuery()
    expect(query).toMatchObject({ source: 'settings', action: 'update', shape: 'single' })
    expect(query.values).toEqual({ quiet_hours_enabled: false })
    expect(columnsOf(query)).toContain('owner_id')
  })

  it('says when there is no settings row to read', async () => {
    fake.reply({ data: null })
    expect(await failureOf(api.getSettings())).toMatchObject({ code: 'not_found' })
  })
})

describe('database failures', () => {
  it('reads an expired token as an ended session', async () => {
    fake.reply({ error: { code: 'PGRST301', message: 'JWT expired' }, status: 401 })
    expect(await failureOf(api.listTasks())).toMatchObject({
      code: 'unauthorized',
      message: 'Your session has ended. Sign in again.',
    })
  })

  it('reads a request that never completed as a connection problem', async () => {
    fake.reply({ error: { message: 'TypeError: Failed to fetch' }, status: 0 })
    expect(await failureOf(api.listAlerts())).toMatchObject({ code: 'network' })
  })

  it('shows the database’s own sentence when a check in the migration refuses a value', async () => {
    const message = 'Write each repo as owner/name, like acme/website.'
    fake.reply({ error: { code: 'JV400', message }, status: 400 })
    const error = await failureOf(api.updateSettings({ allowed_repos: ['nope'] }))
    expect(error).toMatchObject({ code: 'invalid', message })
    expect(error.cause).toMatchObject({ code: 'JV400' })
  })
})
