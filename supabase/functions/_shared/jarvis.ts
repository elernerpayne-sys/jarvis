/**
 * Client for the owner's separate Jarvis backend.
 *
 * The four calls in docs/backend.md, each with `Authorization: Bearer
 * <JARVIS_API_KEY>` and a 10 second deadline. Every URL is built from
 * JARVIS_API_URL and an id that has already been checked to be a uuid;
 * nothing a caller typed ends up in a URL. No call ever throws: each answers
 * with a result whose `detail` is one plain sentence, safe to show the owner.
 */
import { type Env, listNames, missingSecrets, secret } from './env.ts'
import { type FetchLike, httpRequest, parseJson, seconds } from './fetch.ts'

export const JARVIS_TIMEOUT_MS = 10_000

export type JarvisConfig =
  | { state: 'ready'; baseUrl: string; apiKey: string }
  /** One or both of JARVIS_API_URL / JARVIS_API_KEY is not set. */
  | { state: 'missing'; missing: string[]; detail: string }
  /** JARVIS_API_URL is set but is not a usable address. */
  | { state: 'invalid'; detail: string }

/**
 * A base URL we are willing to send the API key to: http or https, no
 * embedded credentials, no query or fragment, trailing slashes removed.
 * Returns null for anything else.
 */
export function normalizeBaseUrl(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (!url.hostname || url.username || url.password || url.search || url.hash) return null
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

export function jarvisConfig(env: Env): JarvisConfig {
  const missing = missingSecrets(env, ['JARVIS_API_URL', 'JARVIS_API_KEY'])
  if (missing.length > 0) {
    return {
      state: 'missing',
      missing,
      detail: `Add ${listNames(missing)} to connect your Jarvis backend.`,
    }
  }
  const baseUrl = normalizeBaseUrl(secret(env, 'JARVIS_API_URL') ?? '')
  if (!baseUrl) {
    return {
      state: 'invalid',
      detail:
        'JARVIS_API_URL is not a usable address. It should look like https://jarvis.example.com with no query string.',
    }
  }
  return { state: 'ready', baseUrl, apiKey: secret(env, 'JARVIS_API_KEY') ?? '' }
}

export type BackendFailure = 'timeout' | 'unreachable' | 'status'

export type BackendResult =
  | { ok: true; status: number; body: unknown; ms: number }
  | {
      ok: false
      kind: BackendFailure
      /** The HTTP status when the backend answered, else null. */
      status: number | null
      /** One plain sentence. No address, no key, no reply body. */
      detail: string
      ms: number
    }

export interface TaskHandoff {
  task_id: string
  title: string
  repo: string
  instructions: string
}

export interface JarvisBackend {
  health(): Promise<BackendResult>
  createTask(task: TaskHandoff): Promise<BackendResult>
  /** `deadlineMs` shortens the wait for a follow-up nobody is waiting on. */
  cancelTask(taskId: string, deadlineMs?: number): Promise<BackendResult>
  sendDecision(
    approvalId: string,
    decision: 'approved' | 'denied',
    taskId: string | null,
  ): Promise<BackendResult>
}

export function jarvisBackend(
  config: { baseUrl: string; apiKey: string },
  fetchFn: FetchLike,
  timeoutMs: number = JARVIS_TIMEOUT_MS,
): JarvisBackend {
  async function call(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    deadlineMs: number,
  ): Promise<BackendResult> {
    const outcome = await httpRequest(fetchFn, `${config.baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      json: method === 'POST' ? body : undefined,
      timeoutMs: deadlineMs,
      tag: 'jarvis-backend',
    })
    if (outcome.kind === 'timeout') {
      return {
        ok: false,
        kind: 'timeout',
        status: null,
        detail: `Your Jarvis backend didn't answer within ${seconds(deadlineMs)}.`,
        ms: outcome.ms,
      }
    }
    if (outcome.kind === 'network') {
      return {
        ok: false,
        kind: 'unreachable',
        status: null,
        detail: "Your Jarvis backend couldn't be reached. Check that it is running and that JARVIS_API_URL is right.",
        ms: outcome.ms,
      }
    }
    if (!outcome.ok) {
      return {
        ok: false,
        kind: 'status',
        status: outcome.status,
        detail: statusSentence(outcome.status),
        ms: outcome.ms,
      }
    }
    return { ok: true, status: outcome.status, body: parseJson(outcome.text), ms: outcome.ms }
  }

  return {
    health: () => call('GET', '/health', undefined, timeoutMs),
    createTask: (task) =>
      call(
        'POST',
        '/tasks',
        {
          task_id: task.task_id,
          title: task.title,
          repo: task.repo,
          instructions: task.instructions,
        },
        timeoutMs,
      ),
    cancelTask: (taskId, deadlineMs) =>
      call(
        'POST',
        `/tasks/${encodeURIComponent(taskId)}/cancel`,
        {},
        Math.min(deadlineMs ?? timeoutMs, timeoutMs),
      ),
    sendDecision: (approvalId, decision, taskId) =>
      call(
        'POST',
        `/approvals/${encodeURIComponent(approvalId)}/decision`,
        { decision, task_id: taskId },
        timeoutMs,
      ),
  }
}

function statusSentence(status: number): string {
  if (status === 401 || status === 403) {
    return `Your Jarvis backend rejected the API key (HTTP ${status}). Check JARVIS_API_KEY.`
  }
  if (status >= 300 && status < 400) {
    return `Your Jarvis backend answered with a redirect (HTTP ${status}). Point JARVIS_API_URL at the final address.`
  }
  if (status === 404) {
    return 'Your Jarvis backend does not have that endpoint (HTTP 404). Check JARVIS_API_URL.'
  }
  return `Your Jarvis backend answered with an error (HTTP ${status}).`
}

/**
 * The `external_id` from the backend's reply to POST /tasks, when it sent a
 * usable one. Anything else (no body, a different shape) reads as null.
 */
export function externalIdFrom(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null
  const value = (body as Record<string, unknown>).external_id
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= 200 ? trimmed : null
}
