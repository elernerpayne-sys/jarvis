/**
 * A stand-in for the Supabase client, for tests only.
 *
 * It records what the live service asks for (table, columns, filters, order,
 * limit) and answers with whatever the test queued, so a test can say "this
 * method must send this query" without a database.
 */
import { vi } from 'vitest'

export type Filter = readonly [method: string, ...args: unknown[]]

export interface QueryRecord {
  /** The table name, or "rpc:<function>" for a database function. */
  source: string
  action: 'select' | 'insert' | 'update' | 'delete' | 'rpc'
  /** Arguments of an rpc call. */
  args?: unknown
  /** The row sent by an insert or update. */
  values?: unknown
  /** Columns asked for, by a read or by a write that returns its row. */
  columns?: string
  filters: Filter[]
  order: Array<[column: string, direction: 'asc' | 'desc']>
  limit?: number
  shape: 'many' | 'single' | 'maybeSingle'
}

export interface DbReply {
  data?: unknown
  error?: { message: string; code?: string; details?: string; hint?: string } | null
  status?: number
}

interface DbAnswer {
  data: unknown
  error: DbReply['error'] | null
  status: number
}

type Responder = (query: QueryRecord) => DbReply

/** The chainable, awaitable object `from()` and `rpc()` return. */
class FakeQuery implements PromiseLike<DbAnswer> {
  private readonly record: QueryRecord
  private readonly answer: (record: QueryRecord) => DbAnswer

  constructor(record: QueryRecord, answer: (record: QueryRecord) => DbAnswer) {
    this.record = record
    this.answer = answer
  }

  select(columns = '*'): this {
    this.record.columns = columns
    return this
  }
  insert(values: unknown): this {
    this.record.action = 'insert'
    this.record.values = values
    return this
  }
  update(values: unknown): this {
    this.record.action = 'update'
    this.record.values = values
    return this
  }
  delete(): this {
    this.record.action = 'delete'
    return this
  }
  eq(column: string, value: unknown): this {
    return this.filter('eq', column, value)
  }
  neq(column: string, value: unknown): this {
    return this.filter('neq', column, value)
  }
  gte(column: string, value: unknown): this {
    return this.filter('gte', column, value)
  }
  in(column: string, values: readonly unknown[]): this {
    return this.filter('in', column, values)
  }
  is(column: string, value: unknown): this {
    return this.filter('is', column, value)
  }
  not(column: string, operator: string, value: unknown): this {
    return this.filter('not', column, operator, value)
  }
  order(column: string, options?: { ascending?: boolean }): this {
    this.record.order.push([column, options?.ascending === false ? 'desc' : 'asc'])
    return this
  }
  limit(count: number): this {
    this.record.limit = count
    return this
  }
  single(): this {
    this.record.shape = 'single'
    return this
  }
  maybeSingle(): this {
    this.record.shape = 'maybeSingle'
    return this
  }

  then<A = DbAnswer, B = never>(
    onfulfilled?: ((value: DbAnswer) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.answer(this.record)).then(onfulfilled, onrejected)
  }

  private filter(...entry: Filter): this {
    this.record.filters.push(entry)
    return this
  }
}

type StateListener = (state: string, error?: Error) => void

interface Binding {
  type: string
  filter: { event: string; schema: string; table: string }
  callback: (payload: unknown) => void
}

/** What `client.channel(name)` returns. */
export class FakeChannel {
  readonly name: string
  readonly bindings: Binding[] = []
  removed = false
  private listener: StateListener | null = null

  constructor(name: string) {
    this.name = name
  }

  on(type: string, filter: Binding['filter'], callback: Binding['callback']): this {
    // The real channel throws here too; it is the reason every subscription needs its own channel.
    if (this.listener) throw new Error(`cannot add \`${type}\` callbacks for ${this.name} after \`subscribe()\`.`)
    this.bindings.push({ type, filter, callback })
    return this
  }

  subscribe(listener: StateListener): this {
    this.listener = listener
    return this
  }

  get tables(): string[] {
    return this.bindings.map((binding) => binding.filter.table)
  }

  /** The server (or the socket) reports a new state for this channel. */
  report(state: 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED'): void {
    this.listener?.(state)
  }

  /** A row changed in `table`. */
  emit(table: string, payload: { eventType: 'INSERT' | 'UPDATE' | 'DELETE'; new: unknown; old: unknown }): void {
    for (const binding of this.bindings) {
      if (binding.filter.table === table) {
        binding.callback({ schema: 'public', table, commit_timestamp: '2026-11-19T12:00:00Z', errors: [], ...payload })
      }
    }
  }
}

export interface FakeSession {
  access_token: string
  user: { id: string; email?: string }
}

type AuthListener = (event: string, session: FakeSession | null) => void

export function createFakeSupabase() {
  const queries: QueryRecord[] = []
  const channels: FakeChannel[] = []
  const authListeners = new Set<AuthListener>()
  let respond: Responder = () => ({ data: [] })

  function answer(record: QueryRecord): DbAnswer {
    queries.push(record)
    const reply = respond(record)
    if (reply.error) return { data: null, error: reply.error, status: reply.status ?? 400 }
    const data = reply.data ?? null
    // supabase-js turns "no row" into an error for .single() and into null for .maybeSingle().
    if (record.shape === 'single' && data === null) {
      return {
        data: null,
        error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: 'The result contains 0 rows' },
        status: 406,
      }
    }
    return { data, error: null, status: reply.status ?? 200 }
  }

  function start(source: string, action: QueryRecord['action'], args?: unknown): FakeQuery {
    return new FakeQuery({ source, action, args, filters: [], order: [], shape: 'many' }, answer)
  }

  const auth = {
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
    signInWithPassword: vi.fn(),
    signInWithOtp: vi.fn(),
    verifyOtp: vi.fn(),
    signOut: vi.fn(),
  }
  const functions = { invoke: vi.fn() }
  const realtime = { setAuth: vi.fn() }
  const channel = vi.fn()
  const removeChannel = vi.fn()

  /** Back to a signed-out client that answers every query with no rows. */
  function reset(): void {
    queries.length = 0
    channels.length = 0
    authListeners.clear()
    respond = () => ({ data: [] })

    auth.getSession.mockReset().mockResolvedValue({ data: { session: null }, error: null })
    auth.onAuthStateChange.mockReset().mockImplementation((listener: AuthListener) => {
      authListeners.add(listener)
      return { data: { subscription: { unsubscribe: () => authListeners.delete(listener) } } }
    })
    auth.signInWithPassword.mockReset().mockResolvedValue({ data: { user: null, session: null }, error: null })
    auth.signInWithOtp.mockReset().mockResolvedValue({ data: { user: null, session: null }, error: null })
    auth.verifyOtp.mockReset().mockResolvedValue({ data: { user: null, session: null }, error: null })
    auth.signOut.mockReset().mockResolvedValue({ error: null })

    functions.invoke.mockReset().mockResolvedValue({ data: {}, error: null })
    realtime.setAuth.mockReset().mockResolvedValue(undefined)
    channel.mockReset().mockImplementation((name: string) => {
      const created = new FakeChannel(name)
      channels.push(created)
      return created
    })
    removeChannel.mockReset().mockImplementation(async (removed: FakeChannel) => {
      removed.removed = true
      return 'ok'
    })
  }

  reset()

  return {
    /** Hand this to the mocked `createClient`. */
    client: {
      from: (table: string) => start(table, 'select'),
      rpc: (name: string, args?: unknown) => start(`rpc:${name}`, 'rpc', args),
      auth,
      functions,
      realtime,
      channel,
      removeChannel,
    },
    auth,
    functions,
    realtime,
    removeChannel,
    /** Every query that was awaited, in order. */
    queries,
    /** Every channel that was created, in order. */
    channels,
    reset,

    /** Answer every following query with this reply, or decide per query. */
    reply(next: DbReply | Responder): void {
      respond = typeof next === 'function' ? next : () => next
    },

    /** The only query the code under test made. */
    onlyQuery(): QueryRecord {
      if (queries.length !== 1) throw new Error(`Expected exactly one query, saw ${queries.length}.`)
      return queries[0]
    },

    /** Supabase announces a sign-in, sign-out or token refresh. */
    emitAuth(event: string, session: FakeSession | null): void {
      for (const listener of authListeners) listener(event, session)
    },

    authListenerCount(): number {
      return authListeners.size
    },
  }
}

export type FakeSupabase = ReturnType<typeof createFakeSupabase>

/** Lets promise callbacks that are already queued run (the service awaits a token before it joins a channel). */
export async function flush(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve()
}

/**
 * The one fake a test file shares with its `vi.mock('@supabase/supabase-js')`
 * factory: both import this module, so both see the same instance.
 */
export const fake = createFakeSupabase()
