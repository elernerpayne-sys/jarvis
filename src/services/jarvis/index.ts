/**
 * The Jarvis backend service: the app talks straight to your own server.
 *
 *   http.ts         the fetch client (JSON, bearer token, 15s limit)
 *   session.ts      the token, kept on this device
 *   auth.ts         sign-in for the owner
 *   methods.ts      one endpoint per service method
 *   connections.ts  Settings → Connections, which never fails
 *   events.ts       live updates over Server-Sent Events (sse.ts parses them)
 *   errors.ts       every failure, turned into a ServiceError
 *
 * The endpoints it expects are described in docs/app-api.md.
 */
import type { JarvisService } from '@/services/types'

import { createAuth } from './auth'
import { createSubscribe } from './events'
import { createHttpClient } from './http'
import type { FetchLike } from './http'
import { createMethods } from './methods'
import { createSessionStore } from './session'

export interface JarvisBackendOptions {
  /** Defaults to the browser's fetch. Tests pass a fake. */
  fetch?: FetchLike
  /** Per-request limit in milliseconds. Defaults to 15 seconds. */
  timeoutMs?: number
}

export function createJarvisBackendService(baseUrl: string, options: JarvisBackendOptions = {}): JarvisService {
  const client = createHttpClient({ baseUrl, sessions: createSessionStore(), ...options })
  return {
    mode: 'live',
    auth: createAuth(client),
    ...createMethods(client),
    subscribe: createSubscribe(client),
  }
}
