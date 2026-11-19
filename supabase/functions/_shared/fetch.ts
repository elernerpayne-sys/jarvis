/**
 * One outbound HTTP request with a hard deadline.
 *
 * `httpRequest` never throws. It answers with what happened: a response, a
 * timeout, or a network failure. Redirects are not followed, so a bearer
 * token is never carried to a host other than the configured one. The body
 * of a successful reply is read up to a size limit; the body of a failed
 * reply is discarded unread, so it can never end up in a message or a log.
 */
import { describeError } from './http.ts'

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export type HttpOutcome =
  | {
      kind: 'response'
      status: number
      ok: boolean
      /** Body of a 2xx reply, or null when it was not 2xx or was too large. */
      text: string | null
      ms: number
    }
  | { kind: 'timeout'; ms: number }
  | { kind: 'network'; ms: number }

export interface RequestOptions {
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  /** Sent as JSON when given. */
  json?: unknown
  timeoutMs: number
  /** Largest successful body worth reading. Defaults to 256 KB. */
  maxBytes?: number
  /** Short name for the log line, e.g. "elevenlabs". Never a URL. */
  tag: string
}

const DEFAULT_MAX_BYTES = 262_144

export async function httpRequest(
  fetchFn: FetchLike,
  url: string,
  options: RequestOptions,
): Promise<HttpOutcome> {
  const started = performance.now()
  const elapsed = () => Math.max(0, Math.round(performance.now() - started))

  const controller = new AbortController()
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<'deadline'>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true
      controller.abort()
      resolve('deadline')
    }, options.timeoutMs)
  })

  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers }
  const init: RequestInit = {
    method: options.method ?? 'GET',
    headers,
    redirect: 'manual',
    signal: controller.signal,
  }
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(options.json)
  }

  const exchange = (async (): Promise<HttpOutcome> => {
    const response = await fetchFn(url, init)
    let text: string | null = null
    if (response.ok) {
      text = await readText(response, options.maxBytes ?? DEFAULT_MAX_BYTES)
    } else {
      await response.body?.cancel().catch(() => {})
    }
    return { kind: 'response', status: response.status, ok: response.ok, text, ms: elapsed() }
  })()
  // If the deadline wins the race, the exchange rejects later with nobody listening.
  exchange.catch(() => {})

  try {
    const winner = await Promise.race([exchange, deadline])
    if (winner === 'deadline') return { kind: 'timeout', ms: elapsed() }
    return winner
  } catch (error) {
    if (timedOut) return { kind: 'timeout', ms: elapsed() }
    console.error(`${options.tag}: request failed before a reply`, describeError(error))
    return { kind: 'network', ms: elapsed() }
  } finally {
    clearTimeout(timer)
  }
}

async function readText(response: Response, maxBytes: number): Promise<string | null> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

/** Parses a JSON body, or returns undefined when there is none or it is not JSON. */
export function parseJson(text: string | null): unknown {
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

/** "6 seconds", "1 second", "1.5 seconds". */
export function seconds(ms: number): string {
  const value = Math.round(ms / 100) / 10
  return `${value} ${value === 1 ? 'second' : 'seconds'}`
}
