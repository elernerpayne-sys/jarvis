/**
 * Every request to a third party goes through here: a hard deadline, no
 * redirects followed, and an outcome instead of an exception. URLs are built
 * from configuration only, never from anything a request sent us.
 */
export type Outcome =
  | { kind: 'response'; status: number; ok: boolean; text: string; ms: number }
  | { kind: 'timeout'; ms: number }
  | { kind: 'network'; ms: number }

export async function send(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs: number },
): Promise<Outcome> {
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), init.timeoutMs)
  try {
    const response = await fetch(url, {
      method: init.method ?? 'GET',
      headers: init.headers,
      body: init.body,
      redirect: 'manual',
      signal: controller.signal,
    })
    const text = await response.text()
    return { kind: 'response', status: response.status, ok: response.ok, text, ms: Date.now() - started }
  } catch {
    const ms = Date.now() - started
    return controller.signal.aborted ? { kind: 'timeout', ms } : { kind: 'network', ms }
  } finally {
    clearTimeout(timer)
  }
}

/** "timeout", "network" or "HTTP 401", for log lines (never the body: it may echo a secret). */
export function label(outcome: Outcome): string {
  return outcome.kind === 'response' ? `HTTP ${outcome.status}` : outcome.kind
}

export function seconds(ms: number): string {
  const s = Math.round(ms / 1000)
  return s === 1 ? '1 second' : `${s} seconds`
}

export function basicAuth(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`
}
