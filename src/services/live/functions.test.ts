import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SERVICE_KEYS } from '@/lib/types'
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

function httpFailure(status: number, body: unknown) {
  const response = new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  return { data: null, error: new FunctionsHttpError(response), response }
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

describe('edge functions', () => {
  it('asks elevenlabs-signed-url for a voice session', async () => {
    fake.functions.invoke.mockResolvedValue({ data: { signed_url: 'wss://example.test/x' }, error: null })
    expect(await api.getVoiceSession()).toEqual({ signed_url: 'wss://example.test/x' })
    expect(fake.functions.invoke).toHaveBeenCalledWith('elevenlabs-signed-url', expect.objectContaining({ body: {} }))
  })

  it('sends the create_task command with trimmed input and returns the task', async () => {
    fake.functions.invoke.mockResolvedValue({ data: { task: rows.task }, error: null })
    expect(await api.createTask({ repo: ' a/b ', instructions: ' Fix it ' })).toEqual(rows.task)
    expect(fake.functions.invoke).toHaveBeenCalledWith(
      'jarvis-command',
      expect.objectContaining({ body: { action: 'create_task', repo: 'a/b', instructions: 'Fix it' } }),
    )
  })

  it('sends cancel_task and decide_approval with the contract’s field names', async () => {
    fake.functions.invoke.mockResolvedValueOnce({ data: { task: rows.task }, error: null })
    await api.cancelTask('task-1')
    expect(fake.functions.invoke).toHaveBeenLastCalledWith(
      'jarvis-command',
      expect.objectContaining({ body: { action: 'cancel_task', task_id: 'task-1' } }),
    )

    fake.functions.invoke.mockResolvedValueOnce({ data: { approval: rows.approval }, error: null })
    expect(await api.decideApproval('approval-1', 'denied')).toEqual(rows.approval)
    expect(fake.functions.invoke).toHaveBeenLastCalledWith(
      'jarvis-command',
      expect.objectContaining({ body: { action: 'decide_approval', approval_id: 'approval-1', decision: 'denied' } }),
    )
  })

  it('shows the function’s own sentence with the matching code', async () => {
    const message = 'That approval is no longer waiting for a decision.'
    fake.functions.invoke.mockResolvedValue(httpFailure(409, { error: { code: 'invalid', message } }))
    expect(await failureOf(api.decideApproval('approval-1', 'approved'))).toMatchObject({ code: 'invalid', message })
  })

  it.each([
    ['forbidden', 403, 'unauthorized'],
    ['not_found', 404, 'not_found'],
    ['not_configured', 503, 'not_configured'],
    ['upstream', 502, 'unknown'],
  ] as const)('maps the function code %s to %s', async (code, status, expected) => {
    fake.functions.invoke.mockResolvedValue(httpFailure(status, { error: { code, message: 'A sentence.' } }))
    expect(await failureOf(api.cancelTask('task-1'))).toMatchObject({ code: expected, message: 'A sentence.' })
  })

  it('names the function it could not reach', async () => {
    fake.functions.invoke.mockResolvedValue({ data: null, error: new FunctionsFetchError(new TypeError('Failed to fetch')) })
    const error = await failureOf(api.getVoiceSession())
    expect(error.code).toBe('network')
    expect(error.message).toContain('elevenlabs-signed-url')
  })

  it('rejects an answer without the row it should carry', async () => {
    fake.functions.invoke.mockResolvedValue({ data: { ok: true }, error: null })
    expect(await failureOf(api.createTask({ repo: 'a/b', instructions: 'x' }))).toMatchObject({ code: 'unknown' })
  })
})

describe('getConnections', () => {
  it('returns one entry per service in order, whatever order the function used', async () => {
    const reported = [...SERVICE_KEYS].reverse().map((service) => ({
      service,
      state: 'connected',
      detail: 'Fine.',
      latency_ms: 12,
      checked_at: '2026-11-19T12:00:00.000Z',
    }))
    fake.functions.invoke.mockResolvedValue({ data: { connections: reported }, error: null })

    const connections = await api.getConnections()
    expect(connections.map((entry) => entry.service)).toEqual([...SERVICE_KEYS])
    expect(connections.every((entry) => entry.state === 'connected')).toBe(true)
    expect(fake.functions.invoke).toHaveBeenCalledWith('connection-status', expect.anything())
  })

  it('resolves with an error entry for every service when the check cannot be reached', async () => {
    fake.functions.invoke.mockResolvedValue({ data: null, error: new FunctionsFetchError(new TypeError('Failed to fetch')) })

    const connections = await api.getConnections()
    expect(connections.map((entry) => entry.service)).toEqual([...SERVICE_KEYS])
    for (const entry of connections) {
      expect(entry.state).toBe('error')
      expect(entry.detail).toContain('connection-status')
    }
  })
})
