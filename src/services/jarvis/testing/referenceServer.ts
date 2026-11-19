/**
 * An in-memory Jarvis backend for tests: it answers every endpoint in
 * docs/app-api.md from the demo service, through real Request and Response
 * objects, so the whole client is exercised end to end. It is also a working
 * sketch of the contract for whoever builds the real backend.
 */
import type { ChangeEvent, RealtimeTable } from '@/lib/types'
import { REALTIME_TABLES } from '@/lib/types'
import { createDemoService } from '@/services/demo'
import type { DemoService } from '@/services/demo'
import { ServiceError, isServiceError } from '@/services/errors'
import type { ServiceErrorCode } from '@/services/errors'

import type { FetchLike } from '../http'

export const BASE_URL = 'https://jarvis.test'
export const OWNER = { id: 'owner-1', email: 'owner@example.com', password: 'correct horse' }
export const EMAIL_CODE = '123456'

type Params = Record<string, string>
type Handler = (context: { params: Params; query: URLSearchParams; body: Record<string, unknown> }) => Promise<unknown>

const STATUS: Record<ServiceErrorCode, [number, string]> = {
  not_found: [404, 'not_found'],
  invalid: [400, 'invalid'],
  unauthorized: [401, 'unauthorized'],
  not_configured: [503, 'not_configured'],
  network: [502, 'upstream'],
  unknown: [500, 'internal'],
}

function json(status: number, body?: unknown): Response {
  if (body === undefined) return new Response(null, { status })
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function fail(status: number, code: string, message: string): Response {
  return json(status, { error: { code, message } })
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError')
}

export interface ReferenceServer {
  fetch: FetchLike
  demo: DemoService
  /** Every request, as "METHOD /path?query". */
  log: string[]
  /** Routes ("METHOD /app/pattern") to answer with 501, as if not built yet. */
  unbuilt: Set<string>
  /** Tokens the server currently accepts. */
  tokens: Set<string>
  /** Event streams currently open. */
  openStreams(): number
  /** Writes raw text to every open event stream. */
  broadcast(text: string): void
  dispose(): void
}

export function createReferenceServer(): ReferenceServer {
  const demo = createDemoService({ simulate: false, latency: false, scenario: null, seed: 7 })
  const log: string[] = []
  const unbuilt = new Set<string>()
  const tokens = new Set<string>()
  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>()
  const encoder = new TextEncoder()
  let tokenCount = 0

  function issue() {
    tokenCount += 1
    const token = `token-${tokenCount}`
    tokens.add(token)
    return { token, user: { id: OWNER.id, email: OWNER.email } }
  }

  const routes: [string, string, Handler][] = []
  const route = (method: string, pattern: string, handler: Handler) => routes.push([method, pattern, handler])

  // ── Data ─────────────────────────────────────────────────────────────────
  route('GET', '/app/brief', async ({ query }) => {
    if (!query.get('from') || !query.get('to')) throw new ServiceError('invalid', 'Send from and to.')
    const { date: _date, ...counts } = await demo.getBrief()
    return counts
  })
  route('GET', '/app/approvals', async ({ query }) => {
    const status = query.get('status') as 'pending' | null
    return { approvals: await demo.listApprovals(status ? { status } : {}) }
  })
  route('POST', '/app/approvals/:id/decision', async ({ params, body }) => ({
    approval: await demo.decideApproval(params.id, body.decision as 'approved'),
  }))
  route('GET', '/app/alerts', async ({ query }) => ({
    alerts: await demo.listAlerts({ limit: Number(query.get('limit') ?? 50) }),
  }))
  route('POST', '/app/alerts/read-all', async () => demo.markAllAlertsRead())
  route('POST', '/app/alerts/:id/read', async ({ params }) => demo.markAlertRead(params.id))
  route('GET', '/app/shops', async () => ({ shops: await demo.listShops() }))
  route('GET', '/app/shops/:id', async ({ params }) => ({ shop: await demo.getShop(params.id) }))
  route('GET', '/app/shops/:id/appointments', async ({ params }) => ({
    appointments: await demo.listUpcomingAppointments(params.id),
  }))
  route('GET', '/app/shops/:id/calls', async ({ params, query }) => ({
    calls: await demo.listCalls(params.id, { filter: query.get('filter') === 'problems' ? 'problems' : 'all' }),
  }))
  route('GET', '/app/calls/:id', async ({ params }) => ({ call: await demo.getCall(params.id) }))
  route('GET', '/app/repos', async () => ({ repos: await demo.listAllowedRepos() }))
  route('GET', '/app/tasks', async () => ({ tasks: await demo.listTasks() }))
  route('POST', '/app/tasks', async ({ body }) => ({
    task: await demo.createTask({ repo: String(body.repo ?? ''), instructions: String(body.instructions ?? '') }),
  }))
  route('GET', '/app/tasks/:id', async ({ params }) => ({ task: await demo.getTask(params.id) }))
  route('GET', '/app/tasks/:id/events', async ({ params }) => {
    await demo.getTask(params.id)
    return { events: await demo.listTaskEvents(params.id) }
  })
  route('POST', '/app/tasks/:id/cancel', async ({ params }) => ({ task: await demo.cancelTask(params.id) }))
  route('GET', '/app/handbook', async () => ({ entries: await demo.listHandbookEntries() }))
  route('POST', '/app/handbook', async ({ body }) => ({ entry: await demo.saveHandbookEntry(entryInput(body)) }))
  route('PUT', '/app/handbook/:id', async ({ params, body }) => ({
    entry: await demo.saveHandbookEntry({ ...entryInput(body), id: params.id }),
  }))
  route('DELETE', '/app/handbook/:id', async ({ params }) => demo.deleteHandbookEntry(params.id))
  route('GET', '/app/decisions', async () => ({ decisions: await demo.listDecisions() }))
  route('POST', '/app/decisions', async ({ body }) => ({ decision: await demo.saveDecision(decisionInput(body)) }))
  route('PUT', '/app/decisions/:id', async ({ params, body }) => ({
    decision: await demo.saveDecision({ ...decisionInput(body), id: params.id }),
  }))
  route('DELETE', '/app/decisions/:id', async ({ params }) => demo.deleteDecision(params.id))
  route('GET', '/app/settings', async () => ({ settings: await demo.getSettings() }))
  route('PATCH', '/app/settings', async ({ body }) => ({ settings: await demo.updateSettings(body) }))
  route('GET', '/app/connections', async () => ({ connections: await demo.getConnections() }))
  route('POST', '/app/voice/session', async () => ({ signed_url: 'wss://api.elevenlabs.io/v1/convai/conversation?agent_id=a&conversation_signature=s' }))

  function match(method: string, path: string): { handler: Handler; params: Params; pattern: string } | null {
    const parts = path.split('/')
    for (const [routeMethod, pattern, handler] of routes) {
      const want = pattern.split('/')
      if (routeMethod !== method || want.length !== parts.length) continue
      const params: Params = {}
      let same = true
      want.forEach((piece, i) => {
        if (piece.startsWith(':')) params[piece.slice(1)] = decodeURIComponent(parts[i])
        else if (piece !== parts[i]) same = false
      })
      if (same) return { handler, params, pattern }
    }
    return null
  }

  async function auth(path: string, body: Record<string, unknown>, bearer: string | null): Promise<Response> {
    switch (path) {
      case '/app/auth/login':
        if (body.email === OWNER.email && body.password === OWNER.password) return json(200, issue())
        return fail(401, 'unauthorized', 'That email and password don’t match.')
      case '/app/auth/code':
        return json(204)
      case '/app/auth/verify':
        if (body.email === OWNER.email && body.code === EMAIL_CODE) return json(200, issue())
        return fail(401, 'unauthorized', 'That code is wrong or has expired. Ask for a new one.')
      case '/app/auth/logout':
        if (bearer) tokens.delete(bearer)
        return json(204)
      default:
        return fail(404, 'not_found', 'No such endpoint.')
    }
  }

  function events(tables: readonly RealtimeTable[], signal: AbortSignal | null | undefined): Response {
    let stop = () => {}
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        streams.add(controller)
        const unsubscribe = demo.subscribe(tables, (event: ChangeEvent) => {
          const row = event.table === 'calls' && event.row ? withoutTranscript(event.row) : event.row
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ ...event, row })}\n\n`))
        })
        stop = () => {
          unsubscribe()
          streams.delete(controller)
        }
        signal?.addEventListener('abort', () => {
          stop()
          try {
            controller.error(abortError())
          } catch {
            // Already closed.
          }
        })
        controller.enqueue(encoder.encode(': connected\n\n'))
      },
      cancel() {
        stop()
      },
    })
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  }

  async function handle(request: Request, signal: AbortSignal | null | undefined): Promise<Response> {
    const url = new URL(request.url)
    log.push(`${request.method} ${url.pathname}${url.search}`)
    if (!request.url.startsWith(`${BASE_URL}/app/`)) return fail(404, 'not_found', 'No such endpoint.')
    const text = await request.text()
    const body = (text ? JSON.parse(text) : {}) as Record<string, unknown>
    const header = request.headers.get('Authorization') ?? ''
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : null

    if (url.pathname.startsWith('/app/auth/') && url.pathname !== '/app/auth/me') return auth(url.pathname, body, bearer)
    if (!bearer || !tokens.has(bearer)) return fail(401, 'unauthorized', 'Your session has ended. Sign in again.')
    if (url.pathname === '/app/auth/me') return json(200, { user: { id: OWNER.id, email: OWNER.email } })
    if (request.method === 'GET' && url.pathname === '/app/events') {
      const asked = (url.searchParams.get('tables') ?? '').split(',')
      return events(REALTIME_TABLES.filter((table) => asked.includes(table)), signal)
    }

    const found = match(request.method, url.pathname)
    if (!found) return fail(404, 'not_configured', 'Your Jarvis backend doesn’t support this yet.')
    if (unbuilt.has(`${request.method} ${found.pattern}`)) return fail(501, 'not_configured', 'Not built yet.')
    try {
      const result = await found.handler({ params: found.params, query: url.searchParams, body })
      if (result === undefined) return json(204)
      const created = request.method === 'POST' && /^\/app\/(tasks|handbook|decisions)$/.test(found.pattern)
      return json(created ? 201 : 200, result)
    } catch (error) {
      if (isServiceError(error)) {
        const [status, code] = STATUS[error.code]
        return fail(status, code, error.message)
      }
      return fail(500, 'internal', 'Something broke.')
    }
  }

  const fetch: FetchLike = async (input, init) => {
    const signal = init.signal
    if (signal?.aborted) throw abortError()
    // The signal is handled here rather than given to Request: jsdom's
    // AbortSignal is not the one Node's Request accepts.
    const request = new Request(input, { method: init.method, headers: init.headers, body: init.body })
    return new Promise<Response>((resolve, reject) => {
      signal?.addEventListener('abort', () => reject(abortError()))
      handle(request, signal).then(resolve, reject)
    })
  }

  return {
    fetch,
    demo,
    log,
    unbuilt,
    tokens,
    openStreams: () => streams.size,
    broadcast(text) {
      for (const controller of streams) controller.enqueue(encoder.encode(text))
    },
    dispose() {
      for (const controller of [...streams]) {
        try {
          controller.close()
        } catch {
          // Already closed.
        }
      }
      streams.clear()
      demo.dispose()
    },
  }
}

function withoutTranscript(row: object): object {
  const copy: Record<string, unknown> = { ...row }
  delete copy.transcript
  return copy
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : []
}

function entryInput(body: Record<string, unknown>) {
  return {
    title: String(body.title ?? ''),
    category: String(body.category ?? ''),
    content: String(body.content ?? ''),
    tags: strings(body.tags),
  }
}

function decisionInput(body: Record<string, unknown>) {
  return {
    title: String(body.title ?? ''),
    decision: String(body.decision ?? ''),
    rationale: typeof body.rationale === 'string' ? body.rationale : null,
    decided_on: String(body.decided_on ?? ''),
    tags: strings(body.tags),
  }
}
