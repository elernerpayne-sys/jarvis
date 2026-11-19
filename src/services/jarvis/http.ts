/**
 * The small fetch client every call goes through: JSON in and out, the
 * owner's bearer token, a 15-second limit, and one place where a 401 ends
 * the session.
 */
import { httpError, networkError, unreadable } from './errors'
import type { SessionStore } from './session'

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export const REQUEST_TIMEOUT_MS = 15_000

type Query = Record<string, string | number | undefined>

export interface RequestOptions {
  body?: unknown
  query?: Query
  /** Extra headers, e.g. a token that is no longer the stored one. */
  headers?: Record<string, string>
}

export interface Answer {
  status: number
  ok: boolean
  /** Parsed JSON, or undefined when the body was empty or not JSON. */
  body: unknown
  /** True when the body had text that was not JSON. */
  garbled: boolean
}

export interface HttpClient {
  readonly baseUrl: string
  readonly fetch: FetchLike
  readonly sessions: SessionStore
  /** Builds the full address for a path under the base URL. */
  url(path: string, query?: Query): string
  /** Headers for an authenticated request (the bearer token, when signed in). */
  authHeaders(): Record<string, string>
  /** Sends a request and returns whatever came back. Throws only when nothing came back. */
  send(method: string, path: string, options?: RequestOptions & { auth?: boolean }): Promise<Answer>
  /** Sends an authenticated request and returns the JSON body; any failure throws a ServiceError. */
  request(method: string, path: string, options?: RequestOptions): Promise<unknown>
  /** Call when the backend says the session is over: forgets the token if it is still the one used. */
  endSession(token: string | null): void
}

export function createHttpClient(options: {
  baseUrl: string
  sessions: SessionStore
  fetch?: FetchLike
  timeoutMs?: number
}): HttpClient {
  const baseUrl = options.baseUrl.trim().replace(/\/+$/, '')
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init))
  const { sessions } = options

  function url(path: string, query?: Query): string {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) params.set(key, String(value))
    }
    const search = params.toString()
    return `${baseUrl}${path}${search ? `?${search}` : ''}`
  }

  function authHeaders(): Record<string, string> {
    const token = sessions.get()?.token
    return token ? { Authorization: `Bearer ${token}` } : {}
  }

  function endSession(token: string | null) {
    if (token !== null && sessions.get()?.token === token) sessions.set(null)
  }

  async function send(
    method: string,
    path: string,
    { body, query, headers: extra, auth = true }: RequestOptions & { auth?: boolean } = {},
  ) {
    const headers: Record<string, string> = { Accept: 'application/json', ...(auth ? authHeaders() : {}), ...extra }
    if (body !== undefined) headers['Content-Type'] = 'application/json'

    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)

    try {
      const response = await doFetch(url(path, query), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })
      const text = await response.text()
      let parsed: unknown
      let garbled = false
      if (text.trim() !== '') {
        try {
          parsed = JSON.parse(text)
        } catch {
          garbled = true
        }
      }
      return { status: response.status, ok: response.ok, body: parsed, garbled }
    } catch (cause) {
      throw networkError(cause, timedOut)
    } finally {
      clearTimeout(timer)
    }
  }

  async function request(method: string, path: string, options: RequestOptions = {}) {
    const token = sessions.get()?.token ?? null
    const answer = await send(method, path, options)
    if (!answer.ok) {
      if (answer.status === 401) endSession(token)
      throw httpError(answer.status, answer.body)
    }
    if (answer.garbled) throw unreadable()
    return answer.body
  }

  return { baseUrl, fetch: doFetch, sessions, url, authHeaders, send, request, endSession }
}
