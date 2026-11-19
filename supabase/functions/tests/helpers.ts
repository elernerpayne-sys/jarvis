// Fakes shared by the tests: auth, database, outbound fetch, environment.
import type { AuthDeps, OwnerLookup, VerifiedToken } from '../_shared/auth.ts'
import type { Db, DbResult, Row } from '../_shared/db.ts'
import type { Env } from '../_shared/env.ts'
import type { FetchLike } from '../_shared/fetch.ts'

export const OWNER_ID = '11111111-1111-4111-8111-111111111111'
export const OTHER_ID = '22222222-2222-4222-8222-222222222222'
export const OWNER_TOKEN = 'owner.token.sig'
export const OTHER_TOKEN = 'other.token.sig'
export const ANON_TOKEN = 'anon.token.sig'
export const EXPIRED_TOKEN = 'expired.token.sig'

export function envOf(values: Record<string, string>): Env {
  return (name) => values[name]
}

/** Auth that knows four tokens. readOwnerId mimics RLS: only the owner sees the row. */
export function fakeAuth(calls: string[] = []): AuthDeps {
  const tokens: Record<string, VerifiedToken> = {
    [OWNER_TOKEN]: { sub: OWNER_ID, role: 'authenticated' },
    [OTHER_TOKEN]: { sub: OTHER_ID, role: 'authenticated' },
    [ANON_TOKEN]: { sub: null, role: 'anon' },
  }
  return {
    verifyToken(token) {
      calls.push(`verify:${token}`)
      return Promise.resolve(tokens[token] ?? null)
    },
    readOwnerId(token): Promise<OwnerLookup> {
      calls.push(`owner:${token}`)
      return Promise.resolve({ kind: 'found', ownerId: token === OWNER_TOKEN ? OWNER_ID : null })
    },
  }
}

export type RpcHandler = (args: Record<string, unknown>) => DbResult<unknown>

export interface FakeDb {
  db: () => Db
  /** Every rpc/findById call in order, e.g. "rpc:jarvis_create_task". */
  log: string[]
  args: Record<string, Record<string, unknown>[]>
  /** Times the service-role client was requested. */
  opened: number
}

export function fakeDb(
  rpcs: Record<string, RpcHandler> = {},
  rows: Record<string, Row | null> = {},
): FakeDb {
  const state: FakeDb = { db: () => db, log: [], args: {}, opened: 0 }
  const db: Db = {
    rpc(fn, args) {
      state.log.push(`rpc:${fn}`)
      ;(state.args[fn] ??= []).push(args)
      const handler = rpcs[fn]
      return Promise.resolve(
        handler ? handler(args) : { ok: false, error: { code: 'PGRST202', message: 'no such fn' } },
      )
    },
    findById(table, id) {
      state.log.push(`find:${table}`)
      return Promise.resolve({ ok: true, data: rows[`${table}:${id}`] ?? null })
    },
  }
  state.db = () => {
    state.opened++
    return db
  }
  return state
}

export type Route = (request: { url: string; init: RequestInit }) => Response | 'hang' | 'throw'

export interface FakeFetch {
  fetch: FetchLike
  calls: { url: string; init: RequestInit }[]
}

/** Routes by URL prefix. 'hang' never answers until aborted; 'throw' is a network error. */
export function fakeFetch(routes: Record<string, Route>): FakeFetch {
  const calls: { url: string; init: RequestInit }[] = []
  const fetch: FetchLike = (input, init = {}) => {
    const url = String(input)
    calls.push({ url, init })
    const key = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((prefix) => url.startsWith(prefix))
    if (!key) return Promise.reject(new TypeError(`unexpected fetch ${url}`))
    const result = routes[key]({ url, init })
    if (result === 'throw') return Promise.reject(new TypeError('connection refused'))
    if (result === 'hang') {
      return new Promise((_, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    }
    return Promise.resolve(result)
  }
  return { fetch, calls }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export function post(body?: unknown, token: string | null = OWNER_TOKEN, method = 'POST'): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  return new Request('https://project.supabase.co/functions/v1/x', {
    method,
    headers,
    body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body),
  })
}

export async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>
}

/** Collects console.error/log output during `run` so tests can assert nothing secret is logged. */
export async function captureLogs<T>(run: () => Promise<T>): Promise<{ result: T; logs: string }> {
  const lines: string[] = []
  const original = { error: console.error, log: console.log, warn: console.warn }
  const sink = (...args: unknown[]) => lines.push(args.map(String).join(' '))
  console.error = sink
  console.log = sink
  console.warn = sink
  try {
    const result = await run()
    return { result, logs: lines.join('\n') }
  } finally {
    console.error = original.error
    console.log = original.log
    console.warn = original.warn
  }
}
