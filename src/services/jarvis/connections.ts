/**
 * Settings → Connections. Never rejects: when the check cannot run, each of
 * the four rows says so instead of the screen failing.
 */
import { SERVICE_KEYS } from '@/lib/types'
import type { ConnectionState, ConnectionStatus, ServiceKey } from '@/lib/types'
import { isServiceError } from '@/services/errors'

import type { HttpClient } from './http'

const STATES: readonly ConnectionState[] = ['connected', 'not_configured', 'error']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function couldNotCheck(service: ServiceKey, detail: string, checkedAt: string): ConnectionStatus {
  return { service, state: 'error', detail, latency_ms: null, checked_at: checkedAt }
}

function reported(entries: unknown, service: ServiceKey, checkedAt: string): ConnectionStatus {
  const entry = Array.isArray(entries)
    ? entries.find((item): item is Record<string, unknown> => isRecord(item) && item.service === service)
    : undefined
  const state = STATES.find((known) => known === entry?.state)
  if (entry === undefined || state === undefined) {
    return couldNotCheck(service, 'Your Jarvis backend didn’t report on this service.', checkedAt)
  }
  return {
    service,
    state,
    detail: typeof entry.detail === 'string' ? entry.detail : '',
    latency_ms: typeof entry.latency_ms === 'number' ? entry.latency_ms : null,
    checked_at: typeof entry.checked_at === 'string' ? entry.checked_at : checkedAt,
  }
}

function failureDetail(error: unknown): string {
  if (isServiceError(error) && (error.code === 'unauthorized' || error.code === 'not_configured')) return error.message
  return 'Couldn’t reach your Jarvis backend to check. Check your connection and try again.'
}

export async function connections(client: HttpClient): Promise<ConnectionStatus[]> {
  const checkedAt = new Date().toISOString()
  try {
    const body = await client.request('GET', '/app/connections')
    const entries = Array.isArray(body) ? body : isRecord(body) ? body.connections : undefined
    return SERVICE_KEYS.map((service) => reported(entries, service, checkedAt))
  } catch (error) {
    const detail = failureDetail(error)
    return SERVICE_KEYS.map((service) => couldNotCheck(service, detail, checkedAt))
  }
}
