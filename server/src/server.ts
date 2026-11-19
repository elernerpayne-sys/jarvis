/**
 * The one HTTP service: the app's API (/app), the incoming webhooks
 * (/hooks), a health check (/healthz) and the built app itself, all on one
 * origin. Security headers go on every response.
 */
import { createServer as createHttpServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

import { isReply, registerAppRoutes } from './app.ts'
import { createAuth } from './auth.ts'
import { createBus } from './bus.ts'
import type { Config } from './config.ts'
import { describeConfig } from './config.ts'
import { openDb } from './db.ts'
import { createDispatcher } from './dispatch.ts'
import { handleElevenLabsHook } from './elevenlabs-hook.ts'
import { ApiError, invalid, notConfigured, unauthorized } from './errors.ts'
import { createStreams } from './events.ts'
import { handleEventsHook } from './hooks.ts'
import { bearer, clientIp, createRouter, readJson, sendError, sendJson } from './http.ts'
import { deliverAlert, mailConfigured, sendCodeEmail } from './services.ts'
import { createStatic } from './static.ts'
import { createStore } from './store.ts'
import { log, logError } from './util.ts'

const CSP = [
  "default-src 'self'",
  // The voice SDK loads its audio worklets from blob: URLs, and on some browsers a resampler from jsDelivr.
  "script-src 'self' blob: https://cdn.jsdelivr.net/npm/@alexanderolsen/",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://api.elevenlabs.io wss://api.elevenlabs.io https://livekit.rtc.elevenlabs.io wss://livekit.rtc.elevenlabs.io",
  "media-src 'self' blob: mediastream:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ')

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'microphone=(self), camera=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
}

const AUTH_BODY_LIMIT = 8 * 1024

export interface Running {
  server: Server
  url: string
  port: number
  close(): Promise<void>
}

export function createJarvis(config: Config) {
  const db = openDb(config.dataDir)
  const bus = createBus()
  const store = createStore(db, bus, { deliverAlert: (alert, notify) => deliverAlert(config, alert, notify) })
  const auth = createAuth(db)
  const streams = createStreams(bus, auth, config.heartbeatMs)
  const dispatcher = createDispatcher(store, config)
  const files = createStatic(config.staticDir)
  const router = createRouter()
  registerAppRoutes(router, { store, config, dispatcher })
  store.ensureSettings(auth.owner()?.id ?? null)

  const expiry = setInterval(() => {
    try {
      store.expireDueApprovals()
    } catch (error) {
      logError('approvals: expiry sweep failed', error)
    }
  }, 60_000)
  expiry.unref()

  function cors(req: IncomingMessage, res: ServerResponse): void {
    const origin = req.headers.origin
    if (!origin || !config.allowedOrigins.includes(origin)) return
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    res.setHeader('Access-Control-Max-Age', '86400')
    res.setHeader('Vary', 'Origin')
  }

  async function handleAuth(path: string, req: IncomingMessage, res: ServerResponse, ip: string): Promise<boolean> {
    if (req.method !== 'POST') return false
    const field = (body: Record<string, unknown>, key: string) => (typeof body[key] === 'string' ? (body[key] as string) : '')
    switch (path) {
      case '/app/auth/login': {
        const body = await readJson(req, AUTH_BODY_LIMIT)
        const email = field(body, 'email').trim()
        const password = field(body, 'password')
        if (email === '' || password === '') throw invalid('Enter your email and password.')
        sendJson(res, 200, await auth.login(email, password, ip))
        return true
      }
      case '/app/auth/code': {
        const body = await readJson(req, AUTH_BODY_LIMIT)
        const email = field(body, 'email').trim()
        if (email === '') throw invalid('Enter your email address.')
        if (!mailConfigured(config)) {
          throw notConfigured('Email codes aren’t set up on this Jarvis yet. Sign in with your password.')
        }
        const code = auth.requestCode(email, ip)
        // Sent in the background so the answer takes as long for any address.
        if (code) void sendCodeEmail(config, code.to, code.code).catch((error) => logError('mail: failed', error))
        sendJson(res, 204)
        return true
      }
      case '/app/auth/verify': {
        const body = await readJson(req, AUTH_BODY_LIMIT)
        const email = field(body, 'email').trim()
        const code = field(body, 'code').replace(/\s+/g, '')
        if (email === '' || code === '') throw invalid('Enter the code from the email.')
        sendJson(res, 200, auth.verifyCode(email, code, ip))
        return true
      }
      case '/app/auth/logout': {
        req.resume()
        const tokenHash = auth.revoke(bearer(req))
        if (tokenHash) streams.endSession(tokenHash)
        sendJson(res, 204)
        return true
      }
    }
    return false
  }

  async function handleApp(path: string, url: URL, req: IncomingMessage, res: ServerResponse, ip: string) {
    cors(req, res)
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    if (path.startsWith('/app/auth/') && path !== '/app/auth/me' && (await handleAuth(path, req, res, ip))) return

    const session = auth.session(bearer(req))
    if (!session) {
      req.resume()
      throw unauthorized()
    }
    if (path === '/app/auth/me' && req.method === 'GET') {
      sendJson(res, 200, { user: session.owner })
      return
    }
    if (path === '/app/events' && req.method === 'GET') {
      const corsHeaders: Record<string, string> = {}
      for (const name of ['Access-Control-Allow-Origin', 'Vary']) {
        const value = res.getHeader(name)
        if (typeof value === 'string') corsHeaders[name] = value
      }
      streams.open(req, res, session.tokenHash, url.searchParams, corsHeaders)
      return
    }
    const found = router.find(req.method ?? 'GET', path)
    if (found === null) {
      req.resume()
      throw new ApiError(404, 'not_configured', 'Your Jarvis backend doesn’t support this yet.')
    }
    if (found === 'method') {
      req.resume()
      throw new ApiError(405, 'invalid', 'That method isn’t allowed here.')
    }
    const result = await found.handler({ req, res, params: found.params, query: url.searchParams, ip })
    if (isReply(result)) sendJson(res, result.status, result.body)
    else sendJson(res, 200, result)
  }

  let inFlight = 0

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const started = Date.now()
    inFlight += 1
    res.once('close', () => {
      inFlight -= 1
    })
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value)
    let path = '/'
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      path = url.pathname
      const ip = clientIp(req, config.trustProxy)

      if (path === '/healthz') {
        db.prepare('SELECT 1').get()
        sendJson(res, 200, { ok: true })
        return
      }
      if (path.startsWith('/hooks/')) {
        if (req.method !== 'POST') throw new ApiError(405, 'invalid', 'Send a POST.')
        if (path === '/hooks/events') await handleEventsHook(req, res, store, config)
        else if (path === '/hooks/elevenlabs') await handleElevenLabsHook(req, res, store, config)
        else throw new ApiError(404, 'not_found', 'No such webhook.')
        return
      }
      if (path === '/app' || path.startsWith('/app/')) {
        await handleApp(path, url, req, res, ip)
        return
      }
      if (!(await files.serve(req, res, path, {}))) {
        res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Method not allowed')
      }
    } catch (error) {
      if (error instanceof ApiError) {
        sendError(res, error)
      } else {
        logError(`${req.method} ${path} failed`, error)
        if (!res.headersSent) sendError(res, new ApiError(500, 'internal', 'Something went wrong inside Jarvis. Try again.'))
        else res.end()
      }
    } finally {
      if (path.startsWith('/app/') || path.startsWith('/hooks/')) {
        if (path !== '/app/events') log(`${req.method} ${path} ${res.statusCode} ${Date.now() - started}ms`)
      }
    }
  }

  const server = createHttpServer({ requestTimeout: 30_000, headersTimeout: 15_000 }, (req, res) => {
    void handle(req, res)
  })
  server.keepAliveTimeout = 65_000

  async function bootstrapOwner() {
    if (!config.ownerEmail || !config.ownerPassword) return
    if (auth.owner()) {
      log('owner: OWNER_EMAIL/OWNER_PASSWORD ignored, the owner already exists (use `npm run owner` to change it)')
      return
    }
    const { owner } = await auth.setOwner(config.ownerEmail, config.ownerPassword)
    store.ensureSettings(owner.id)
    log('owner: created from OWNER_EMAIL / OWNER_PASSWORD')
  }

  async function listen(): Promise<Running> {
    await bootstrapOwner()
    await new Promise<void>((resolve) => server.listen(config.port, config.host, resolve))
    const port = (server.address() as AddressInfo).port
    log(`listening on port ${port} (${describeConfig(config)})`)
    if (!auth.owner()) log('owner: none yet. Create one with: npm run owner -- --email you@example.com')
    void dispatcher.sweep()
    let closing: Promise<void> | null = null
    return {
      server,
      port,
      url: `http://127.0.0.1:${port}`,
      close() {
        closing ??= new Promise<void>((resolve) => {
          clearInterval(expiry)
          dispatcher.stop()
          auth.stop()
          streams.closeAll()
          server.close(() => {
            try {
              db.close()
            } catch {
              // already closed
            }
            resolve()
          })
          server.closeIdleConnections()
          // Requests still running get up to 10 seconds; connections doing nothing are closed now.
          const started = Date.now()
          const sweep = setInterval(() => {
            if (inFlight <= 0 || Date.now() - started > 10_000) {
              clearInterval(sweep)
              server.closeAllConnections()
            }
          }, 50)
        })
        return closing
      },
    }
  }

  return { db, store, auth, bus, streams, server, listen }
}
