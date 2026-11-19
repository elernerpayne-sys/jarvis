/** Request and response plumbing: bodies with size limits, JSON answers, client IPs, a tiny router. */
import type { IncomingMessage, ServerResponse } from 'node:http'

import { ApiError } from './errors.ts'
import { isRecord, parseJson } from './util.ts'

export class TooLarge extends Error {}

/** Reads the raw body, refusing more than `limit` bytes. */
export function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? 0)
    if (declared > limit) {
      reject(new TooLarge())
      req.resume()
      return
    }
    const chunks: Buffer[] = []
    let size = 0
    let done = false
    req.on('data', (chunk: Buffer) => {
      if (done) return
      size += chunk.length
      if (size > limit) {
        done = true
        reject(new TooLarge())
        req.resume()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!done) {
        done = true
        resolve(Buffer.concat(chunks))
      }
    })
    req.on('error', (error) => {
      if (!done) {
        done = true
        reject(error)
      }
    })
  })
}

/** A JSON object body ({} when empty). Anything else is a 400. */
export async function readJson(req: IncomingMessage, limit: number): Promise<Record<string, unknown>> {
  let raw: Buffer
  try {
    raw = await readBody(req, limit)
  } catch (error) {
    if (error instanceof TooLarge) throw new ApiError(413, 'invalid', 'That request is too large.')
    throw error
  }
  const text = raw.toString('utf8')
  if (text.trim() === '') return {}
  const parsed = parseJson(text)
  if (parsed === undefined) throw new ApiError(400, 'invalid', 'That request wasn’t valid JSON.')
  if (!isRecord(parsed)) throw new ApiError(400, 'invalid', 'Send a JSON object.')
  return parsed
}

export function sendJson(res: ServerResponse, status: number, body?: unknown): void {
  if (res.headersSent) return
  if (body === undefined) {
    res.writeHead(status)
    res.end()
    return
  }
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  })
  res.end(text)
}

export function sendError(res: ServerResponse, error: ApiError): void {
  sendJson(res, error.status, { error: { code: error.code, message: error.message } })
}

/** The caller's address: the socket, or the entry `trustProxy` hops from the right of X-Forwarded-For. */
export function clientIp(req: IncomingMessage, trustProxy: number): string {
  const socket = req.socket.remoteAddress ?? 'unknown'
  if (trustProxy <= 0) return socket
  const header = req.headers['x-forwarded-for']
  const list = (Array.isArray(header) ? header.join(',') : (header ?? ''))
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  return list[list.length - trustProxy] ?? list[0] ?? socket
}

export function bearer(req: IncomingMessage): string | null {
  const header = req.headers.authorization ?? ''
  const match = /^Bearer\s+(\S+)$/i.exec(header)
  return match ? match[1] : null
}

// ── Router ─────────────────────────────────────────────────────────────────

export interface Context {
  req: IncomingMessage
  res: ServerResponse
  params: Record<string, string>
  query: URLSearchParams
  ip: string
}

export type Handler = (context: Context) => Promise<unknown> | unknown

interface Route {
  method: string
  parts: string[]
  handler: Handler
}

export function createRouter() {
  const routes: Route[] = []

  function add(method: string, pattern: string, handler: Handler) {
    routes.push({ method, parts: pattern.split('/'), handler })
  }

  /** The handler for a path, or 'method' when the path exists with other methods, or null. */
  function find(method: string, path: string): { handler: Handler; params: Record<string, string> } | 'method' | null {
    const parts = path.split('/')
    let pathMatched = false
    for (const route of routes) {
      if (route.parts.length !== parts.length) continue
      const params: Record<string, string> = {}
      let same = true
      for (let i = 0; i < parts.length; i++) {
        const want = route.parts[i]
        if (want.startsWith(':')) {
          let value: string
          try {
            value = decodeURIComponent(parts[i])
          } catch {
            same = false
            break
          }
          if (value === '') {
            same = false
            break
          }
          params[want.slice(1)] = value
        } else if (want !== parts[i]) {
          same = false
          break
        }
      }
      if (!same) continue
      pathMatched = true
      if (route.method === method) return { handler: route.handler, params }
    }
    return pathMatched ? 'method' : null
  }

  return { add, find }
}
