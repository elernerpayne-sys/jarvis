/**
 * GET /app/events: live updates as Server-Sent Events (docs/app-api.md,
 * "Live updates"). One `data:` line per row change, a `: ping` comment every
 * 25 seconds, and the stream ends when its session is revoked or expires.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { RealtimeTable } from '../../src/lib/types.ts'
import type { Auth } from './auth.ts'
import type { Bus } from './bus.ts'
import { ApiError } from './errors.ts'

export const HEARTBEAT_MS = 25_000
const MAX_STREAMS = 20
const TABLES: readonly RealtimeTable[] = ['tasks', 'task_events', 'approvals', 'alerts', 'calls', 'appointments']

export interface Streams {
  open(req: IncomingMessage, res: ServerResponse, tokenHash: string, query: URLSearchParams, headers: Record<string, string>): void
  /** Ends every stream opened with this session (logout). */
  endSession(tokenHash: string): void
  closeAll(): void
  count(): number
}

export function createStreams(bus: Bus, auth: Auth, heartbeatMs = HEARTBEAT_MS): Streams {
  const open = new Map<ServerResponse, { tokenHash: string; stop: () => void }>()

  function close(res: ServerResponse) {
    const entry = open.get(res)
    if (!entry) return
    open.delete(res)
    entry.stop()
    const socket = res.socket
    res.end(() => socket?.destroy())
  }

  return {
    open(req, res, tokenHash, query, headers) {
      if (open.size >= MAX_STREAMS) throw new ApiError(429, 'invalid', 'Too many live connections. Close a tab and try again.')
      const asked = (query.get('tables') ?? '')
        .split(',')
        .map((table) => table.trim())
        .filter(Boolean)
      const wanted = new Set(asked.length === 0 ? TABLES : TABLES.filter((table) => asked.includes(table)))

      res.writeHead(200, {
        ...headers,
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        // The connection carries only this stream; when the stream ends, so does the connection.
        Connection: 'close',
        'X-Accel-Buffering': 'no',
      })
      res.write(': connected\n\n')
      req.socket.setTimeout(0)
      req.socket.setNoDelay(true)

      const unsubscribe = bus.subscribe((change) => {
        if (!wanted.has(change.table)) return
        res.write(`data: ${JSON.stringify(change)}\n\n`)
      })
      const heartbeat = setInterval(() => {
        if (!auth.isLive(tokenHash)) {
          close(res)
          return
        }
        res.write(': ping\n\n')
      }, heartbeatMs)
      const stop = () => {
        unsubscribe()
        clearInterval(heartbeat)
      }
      open.set(res, { tokenHash, stop })
      res.on('close', () => close(res))
      res.on('error', () => close(res))
    },
    endSession(tokenHash) {
      for (const [res, entry] of open) if (entry.tokenHash === tokenHash) close(res)
    },
    closeAll() {
      for (const res of [...open.keys()]) close(res)
    },
    count: () => open.size,
  }
}
