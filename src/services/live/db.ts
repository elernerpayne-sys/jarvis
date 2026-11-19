/**
 * Runs a table or RPC query and unwraps its result. Every query in the live
 * service goes through one of these, so a failure always leaves as a
 * `ServiceError` and never as a raw Supabase object.
 */
import { dayBounds } from '@/lib/format'
import { ServiceError } from '@/services/errors'

import { dbError, unexpectedError } from './errors'
import type { DbFailure, ErrorCopy } from './errors'

/** What every supabase-js query builder resolves to, reduced to what we read. */
interface DbResult {
  data: unknown
  error: DbFailure | null
  status?: number
}

type Query = PromiseLike<DbResult>

async function settle(query: Query, copy: ErrorCopy): Promise<unknown> {
  let result: DbResult
  try {
    result = await query
  } catch (cause) {
    throw unexpectedError(cause)
  }
  if (result.error) throw dbError(result.error, result.status, copy)
  return result.data
}

/** A list. Rows come back exactly as the database sent them. */
export async function many<T>(query: Query): Promise<T[]> {
  const data = await settle(query, {})
  return Array.isArray(data) ? (data as T[]) : []
}

/** One row, or null when it is not there (use with `.maybeSingle()`). */
export async function maybeOne<T>(query: Query, copy: ErrorCopy = {}): Promise<T | null> {
  const data = await settle(query, copy)
  return data === null || data === undefined ? null : (data as T)
}

/** One row that has to exist: a read by id, or a write that returns its row. */
export async function one<T>(query: Query, copy: { notFound: string }): Promise<T> {
  const row = await maybeOne<T>(query, copy)
  if (row === null) throw new ServiceError('not_found', copy.notFound)
  return row
}

/** A write whose result we do not need. */
export async function none(query: Query, copy: ErrorCopy = {}): Promise<void> {
  await settle(query, copy)
}

/** Arguments for the RPCs that count "today": the local calendar day of this device. */
export function todayRange(now: Date = new Date()): { p_from: string; p_to: string } {
  const { from, to } = dayBounds(now)
  return { p_from: from.toISOString(), p_to: to.toISOString() }
}
