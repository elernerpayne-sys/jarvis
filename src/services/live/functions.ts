/**
 * Everything that leaves Supabase goes through an edge function: the voice
 * session (ElevenLabs), commands for the Jarvis backend, and the connection
 * check. The functions hold the secrets; the app only ever sends the owner's
 * session, which `functions.invoke` attaches by itself.
 */
import { SERVICE_KEYS } from '@/lib/types'
import type { Approval, ConnectionState, ConnectionStatus, ServiceKey, Task } from '@/lib/types'
import { ServiceError } from '@/services/errors'
import type { JarvisService } from '@/services/types'

import { getClient } from './client'
import { functionError, unexpectedError } from './errors'

type FunctionName = 'elevenlabs-signed-url' | 'jarvis-command' | 'connection-status'

/**
 * Longer than the ten seconds a function gives the Jarvis backend, so the
 * function's own answer ("your backend didn't respond") gets here first.
 */
const FUNCTION_TIMEOUT_MS = 20_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function unreadable(name: FunctionName): ServiceError {
  return new ServiceError(
    'unknown',
    `The ${name} function sent back something the app couldn’t read. Try again in a moment.`,
  )
}

async function call(name: FunctionName, body: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  let result: { data: unknown; error: unknown }
  try {
    result = await getClient().functions.invoke(name, { body, timeout: FUNCTION_TIMEOUT_MS })
  } catch (cause) {
    throw unexpectedError(cause)
  }
  if (result.error) throw await functionError(name, result.error)
  if (!isRecord(result.data)) throw unreadable(name)
  return result.data
}

/** Reads the row a function wraps its answer in: `{ task }` or `{ approval }`. */
function rowFrom<T>(name: FunctionName, answer: Record<string, unknown>, key: string): T {
  const row = answer[key]
  if (!isRecord(row)) throw unreadable(name)
  return row as T
}

// ── Connection status ──────────────────────────────────────────────────────

const CONNECTION_STATES: readonly ConnectionState[] = ['connected', 'not_configured', 'error']

function couldNotCheck(service: ServiceKey, detail: string, checkedAt: string): ConnectionStatus {
  return { service, state: 'error', detail, latency_ms: null, checked_at: checkedAt }
}

function reportedStatus(entries: unknown, service: ServiceKey, checkedAt: string): ConnectionStatus {
  const entry = Array.isArray(entries)
    ? entries.find((item): item is Record<string, unknown> => isRecord(item) && item.service === service)
    : undefined
  const state = CONNECTION_STATES.find((known) => known === entry?.state)
  if (entry === undefined || state === undefined) {
    return couldNotCheck(service, 'The status check didn’t report on this service. Check again in a moment.', checkedAt)
  }
  return {
    service,
    state,
    detail: typeof entry.detail === 'string' ? entry.detail : '',
    latency_ms: typeof entry.latency_ms === 'number' ? entry.latency_ms : null,
    checked_at: typeof entry.checked_at === 'string' ? entry.checked_at : checkedAt,
  }
}

/** What to show on every row when the check itself did not run. */
function unreachableDetail(error: unknown): string {
  if (error instanceof ServiceError && error.code === 'unauthorized') return error.message
  return 'Couldn’t reach the status check. Check your connection, and make sure the connection-status function is deployed.'
}

export const edgeFunctions: Pick<
  JarvisService,
  'getVoiceSession' | 'createTask' | 'cancelTask' | 'decideApproval' | 'getConnections'
> = {
  async getVoiceSession() {
    const answer = await call('elevenlabs-signed-url')
    const signedUrl = answer.signed_url
    if (typeof signedUrl !== 'string' || signedUrl === '') throw unreadable('elevenlabs-signed-url')
    return { signed_url: signedUrl }
  },

  async createTask(input) {
    const answer = await call('jarvis-command', {
      action: 'create_task',
      repo: input.repo.trim(),
      instructions: input.instructions.trim(),
    })
    return rowFrom<Task>('jarvis-command', answer, 'task')
  },

  async cancelTask(id) {
    const answer = await call('jarvis-command', { action: 'cancel_task', task_id: id })
    return rowFrom<Task>('jarvis-command', answer, 'task')
  },

  async decideApproval(id, decision) {
    const answer = await call('jarvis-command', { action: 'decide_approval', approval_id: id, decision })
    return rowFrom<Approval>('jarvis-command', answer, 'approval')
  },

  /**
   * Never rejects. Settings always has four rows to show: when the check
   * cannot run at all, each row says so instead of the screen failing.
   */
  async getConnections() {
    const checkedAt = new Date().toISOString()
    try {
      const answer = await call('connection-status')
      return SERVICE_KEYS.map((service) => reportedStatus(answer.connections, service, checkedAt))
    } catch (error) {
      const detail = unreachableDetail(error)
      return SERVICE_KEYS.map((service) => couldNotCheck(service, detail, checkedAt))
    }
  },
}
