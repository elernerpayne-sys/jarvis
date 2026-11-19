/**
 * The real Supabase wiring behind the AuthDeps and Db interfaces.
 *
 * This is the only file that imports supabase-js and the only place a
 * Supabase key is read. Handlers get the interfaces, never a client.
 *
 *   liveAuth(env)  verifies the caller's token and reads settings.owner_id as
 *                  the caller (public key + the caller's own token, so
 *                  row-level security decides what comes back).
 *   liveDb(env)    returns a function that builds the service-role client on
 *                  first use. Handlers call it only after the owner check (or,
 *                  in the webhook, after the signature check).
 */
import {
  createClient,
  isAuthRetryableFetchError,
  type SupabaseClient,
} from 'npm:@supabase/supabase-js@2'
import type { AuthDeps, OwnerLookup, VerifiedToken } from './auth.ts'
import type { Db, DbResult, Row } from './db.ts'
import { adminKey, type Env, publicKey, supabaseUrl } from './env.ts'
import { describeError } from './http.ts'

/** No call to Supabase itself may hang a request for longer than this. */
const SUPABASE_TIMEOUT_MS = 15_000

const AUTH_OPTIONS = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
} as const

function timedFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const deadline = AbortSignal.timeout(SUPABASE_TIMEOUT_MS)
  const signal = init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline
  return fetch(input, { ...init, signal })
}

function required(value: string | null, what: string): string {
  if (!value) throw new Error(`${what} is not available in this function's environment`)
  return value
}

function client(env: Env, key: string, headers?: Record<string, string>): SupabaseClient {
  return createClient(required(supabaseUrl(env), 'SUPABASE_URL'), key, {
    auth: AUTH_OPTIONS,
    // Reads are not retried behind the app's back; the app shows the error and retries itself.
    db: { retry: false },
    global: { fetch: timedFetch, ...(headers ? { headers } : {}) },
  })
}

export function liveAuth(env: Env): AuthDeps {
  // One verifier per warm worker, so its cache of the project's signing keys
  // is reused across requests. It holds the public key only.
  let verifier: SupabaseClient | null = null
  const publishable = () => required(publicKey(env), 'The Supabase publishable key')

  return {
    async verifyToken(token: string): Promise<VerifiedToken | null> {
      verifier ??= client(env, publishable())
      let result: Awaited<ReturnType<SupabaseClient['auth']['getClaims']>>
      try {
        // Asymmetric signing keys: verified locally against the project's key
        // set. Legacy HS256 projects: verified by asking the Auth server.
        // Either way this checks the signature and the expiry, nothing else.
        result = await verifier.auth.getClaims(token)
      } catch (error) {
        // getClaims throws (rather than returning an error) only for a token
        // it cannot make sense of, e.g. an unknown signing algorithm.
        console.error('owner-check: token could not be verified', describeError(error))
        return null
      }
      const { data, error } = result
      if (error) {
        const status = (error as { status?: number }).status ?? 0
        if (isAuthRetryableFetchError(error) || status >= 500) {
          throw new Error(`Supabase Auth could not be reached (${error.name})`)
        }
        return null
      }
      if (!data) return null
      const { sub, role } = data.claims
      return {
        sub: typeof sub === 'string' && sub ? sub : null,
        role: typeof role === 'string' ? role : null,
      }
    },

    async readOwnerId(token: string): Promise<OwnerLookup> {
      // The caller's own token and the public key: this query can see exactly
      // what the caller could see from the browser, and nothing more.
      const asCaller = client(env, publishable(), { Authorization: `Bearer ${token}` })
      const { data, error, status } = await asCaller
        .from('settings')
        .select('owner_id')
        .limit(1)
        .maybeSingle()
      if (error) {
        if (status === 401) return { kind: 'unauthorized' }
        return { kind: 'failed', reason: `${error.code ?? status}: ${error.message}` }
      }
      const ownerId = (data as { owner_id?: unknown } | null)?.owner_id
      return { kind: 'found', ownerId: typeof ownerId === 'string' && ownerId ? ownerId : null }
    },
  }
}

/**
 * The service-role database, built on first call. It bypasses row-level
 * security, so nothing may call this before the caller has been verified.
 */
export function liveDb(env: Env): () => Db {
  let admin: SupabaseClient | null = null

  return (): Db => {
    admin ??= client(env, required(adminKey(env), 'The Supabase secret key'))
    const service = admin

    return {
      async rpc(fn: string, args: Record<string, unknown>): Promise<DbResult<unknown>> {
        const { data, error } = await service.rpc(fn, args)
        if (error) return { ok: false, error: { code: error.code || null, message: error.message ?? '' } }
        return { ok: true, data: data as unknown }
      },

      async findById(table: string, id: string, columns: string): Promise<DbResult<Row | null>> {
        const { data, error } = await service.from(table).select(columns).eq('id', id).maybeSingle()
        if (error) return { ok: false, error: { code: error.code || null, message: error.message ?? '' } }
        return { ok: true, data: (data as Row | null) ?? null }
      },
    }
  }
}
