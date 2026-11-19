/**
 * Test helpers: the real server on a random port against a temp DATA_DIR,
 * a fake third-party server (ElevenLabs, Twilio, Notion, Resend, the task
 * runner all point at it), a signed webhook sender and an SSE reader.
 */
import { createHmac } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { IncomingMessage, Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { loadConfig } from '../src/config.ts'
import { createJarvis } from '../src/server.ts'

process.env.JARVIS_LOG ??= 'silent'

export const OWNER = { email: 'owner@example.com', password: 'correct horse battery' }
export const WEBHOOK_SECRET = 'test-webhook-secret'
export const ELEVENLABS_SECRET = 'test-elevenlabs-secret'

export function tempDir(prefix = 'jarvis-test-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

/** A tiny stand-in for dist/: an index, a hashed asset, a service worker. */
export function fakeDist(): string {
  const dir = tempDir('jarvis-dist-')
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Jarvis</title><div id="root"></div>')
  writeFileSync(join(dir, 'assets', 'index-AbC123xY.js'), `console.log(${JSON.stringify('x'.repeat(4000))})`)
  writeFileSync(join(dir, 'sw.js'), 'self.addEventListener("fetch", () => {})')
  writeFileSync(join(dir, 'manifest.webmanifest'), '{"name":"Jarvis"}')
  writeFileSync(join(dir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  return dir
}

// ── Fake upstream ──────────────────────────────────────────────────────────

export interface Recorded {
  method: string
  path: string
  headers: IncomingMessage['headers']
  body: string
}

export type Responder = (request: Recorded) => { status: number; body?: unknown; delayMs?: number } | undefined

export interface Upstream {
  url: string
  requests: Recorded[]
  /** Answers by "METHOD /path" prefix; the first match wins. Default: 404. */
  routes: Map<string, Responder>
  close(): Promise<void>
}

export async function startUpstream(): Promise<Upstream> {
  const requests: Recorded[] = []
  const routes = new Map<string, Responder>()
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const recorded: Recorded = { method: req.method ?? '', path: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks).toString() }
      requests.push(recorded)
      let answer: ReturnType<Responder>
      for (const [key, responder] of routes) {
        if (`${recorded.method} ${recorded.path}`.startsWith(key)) {
          answer = responder(recorded)
          if (answer) break
        }
      }
      const reply = answer ?? { status: 404, body: { detail: 'not found' } }
      const finish = () => {
        res.writeHead(reply.status, { 'Content-Type': 'application/json' })
        res.end(reply.body === undefined ? '' : JSON.stringify(reply.body))
      }
      if (reply.delayMs) setTimeout(finish, reply.delayMs)
      else finish()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    routes,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

// ── The server ─────────────────────────────────────────────────────────────

export interface TestServer {
  url: string
  dataDir: string
  staticDir: string
  jarvis: ReturnType<typeof createJarvis>
  token: string
  api(path: string, options?: { method?: string; body?: unknown; token?: string | null; headers?: Record<string, string> }): Promise<{
    status: number
    body: any
    headers: Headers
  }>
  /** Opens the SQLite file directly (for setting up awkward states). */
  sql(sql: string, ...params: unknown[]): unknown[]
  stop(): Promise<void>
}

export async function startServer(options: { env?: Record<string, string>; dataDir?: string; staticDir?: string; owner?: boolean } = {}): Promise<TestServer> {
  const dataDir = options.dataDir ?? tempDir()
  const staticDir = options.staticDir ?? fakeDist()
  const config = loadConfig({
    PORT: '0',
    HOST: '127.0.0.1',
    DATA_DIR: dataDir,
    STATIC_DIR: staticDir,
    JARVIS_WEBHOOK_SECRET: WEBHOOK_SECRET,
    ELEVENLABS_WEBHOOK_SECRET: ELEVENLABS_SECRET,
    OUTBOUND_TIMEOUT_MS: '2000',
    ...options.env,
  })
  const jarvis = createJarvis(config)
  if (options.owner !== false && !jarvis.auth.owner()) {
    const { owner } = await jarvis.auth.setOwner(OWNER.email, OWNER.password)
    jarvis.store.ensureSettings(owner.id)
  }
  const running = await jarvis.listen()
  const url = running.url

  async function api(path: string, opts: { method?: string; body?: unknown; token?: string | null; headers?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { ...opts.headers }
    const token = opts.token === undefined ? server.token : opts.token
    if (token) headers.Authorization = `Bearer ${token}`
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
    const response = await fetch(`${url}${path}`, {
      method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
      headers,
      body: opts.body === undefined ? undefined : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body),
    })
    const text = await response.text()
    let body: unknown = text
    try {
      body = text ? JSON.parse(text) : undefined
    } catch {
      // not JSON
    }
    return { status: response.status, body: body as any, headers: response.headers }
  }

  const server: TestServer = {
    url,
    dataDir,
    staticDir,
    jarvis,
    token: '',
    api,
    sql(sql, ...params) {
      const db = new DatabaseSync(join(dataDir, 'jarvis.sqlite'))
      try {
        const statement = db.prepare(sql)
        return /^\s*select/i.test(sql) ? statement.all(...(params as never[])) : [statement.run(...(params as never[]))]
      } finally {
        db.close()
      }
    },
    stop: () => running.close(),
  }
  if (options.owner !== false) {
    const login = await api('/app/auth/login', { body: OWNER, token: null })
    server.token = login.body?.token ?? ''
  }
  return server
}

export function cleanup(...dirs: string[]) {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
}

// ── Webhooks ───────────────────────────────────────────────────────────────

export function signature(secret: string, body: string, t = Math.floor(Date.now() / 1000), scheme = 'v1'): string {
  const hmac = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')
  return `t=${t},${scheme}=${hmac}`
}

export async function postHook(server: TestServer, payload: unknown, options: { secret?: string; t?: number; header?: string | null; raw?: string } = {}) {
  const body = options.raw ?? JSON.stringify(payload)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const header = options.header === undefined ? signature(options.secret ?? WEBHOOK_SECRET, body, options.t) : options.header
  if (header !== null) headers['X-Jarvis-Signature'] = header
  const response = await fetch(`${server.url}/hooks/events`, { method: 'POST', headers, body })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : undefined }
}

export async function events(server: TestServer, list: unknown[]) {
  const result = await postHook(server, { events: list })
  return result
}

// ── Live updates ───────────────────────────────────────────────────────────

export interface Stream {
  status: number
  headers: Headers
  /** Every `data:` payload so far, parsed. */
  received: any[]
  comments: string[]
  /** Resolves with the first change matching `test` (already received or still to come). */
  waitFor(test: (change: any) => boolean, timeoutMs?: number): Promise<any>
  close(): void
  ended: Promise<void>
}

export async function openStream(server: TestServer, query = '', token = server.token): Promise<Stream> {
  const controller = new AbortController()
  const response = await fetch(`${server.url}/app/events${query}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
    signal: controller.signal,
  })
  const received: any[] = []
  const comments: string[] = []
  const waiters: { test: (change: any) => boolean; resolve: (change: any) => void }[] = []
  let ended: Promise<void> = Promise.resolve()
  if (!response.ok) await response.body?.cancel()
  if (response.ok && response.body) {
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    ended = (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let index: number
          while ((index = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, index)
            buffer = buffer.slice(index + 2)
            for (const line of block.split('\n')) {
              if (line.startsWith(':')) comments.push(line.slice(1).trim())
              if (line.startsWith('data: ')) {
                const change = JSON.parse(line.slice(6))
                received.push(change)
                for (const waiter of [...waiters]) {
                  if (waiter.test(change)) {
                    waiters.splice(waiters.indexOf(waiter), 1)
                    waiter.resolve(change)
                  }
                }
              }
            }
          }
        }
      } catch {
        // aborted
      }
    })()
  }
  return {
    status: response.status,
    headers: response.headers,
    received,
    comments,
    waitFor(test, timeoutMs = 3000) {
      const already = received.find(test)
      if (already) return Promise.resolve(already)
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('No matching live update arrived.')), timeoutMs)
        waiters.push({
          test,
          resolve: (change) => {
            clearTimeout(timer)
            resolve(change)
          },
        })
      })
    },
    close: () => controller.abort(),
    get ended() {
      return ended
    },
  }
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const isoMinutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()
