/**
 * The small slice of the database the edge functions use, as an interface.
 *
 * Handlers only ever see this, so tests can stand in a fake and the real
 * service-role client (see supabase.ts) is built in exactly one place.
 */
import { errorResponse, internalError, isRecord } from './http.ts'

export interface DbError {
  /** SQLSTATE or PostgREST code when there is one, e.g. "JV404". */
  code: string | null
  message: string
}

export type DbResult<T> = { ok: true; data: T } | { ok: false; error: DbError }

export type Row = Record<string, unknown>

export interface Db {
  /** Calls a Postgres function with the service role. */
  rpc(fn: string, args: Record<string, unknown>): Promise<DbResult<unknown>>
  /** One row by primary key, or null when there is none. */
  findById(table: string, id: string, columns: string): Promise<DbResult<Row | null>>
}

/**
 * A function that returns one table row. PostgREST sends a composite as an
 * object; a `returns setof` function would send a one-element array. Accept
 * both, and insist on a string id either way.
 */
export function singleRow(data: unknown): Row | null {
  const row = Array.isArray(data) && data.length === 1 ? data[0] : data
  return isRecord(row) && typeof row.id === 'string' ? row : null
}

/**
 * Turns an error raised by a jarvis_* function into the response the
 * contract promises. The three JV codes carry a sentence written for the
 * owner, which is passed through. Anything else is ours to fix: it is logged
 * and answered with a generic message.
 */
export function dbErrorResponse(error: DbError, tag: string): Response {
  switch (error.code) {
    case 'JV404':
      return errorResponse(404, 'not_found', ownerMessage(error, 'That no longer exists.'))
    case 'JV400':
      return errorResponse(400, 'invalid', ownerMessage(error, 'That request is not valid.'))
    case 'JV409':
      return errorResponse(409, 'invalid', ownerMessage(error, 'It is too late to do that.'))
    default:
      console.error(`${tag}: database error`, error.code ?? 'no-code', error.message.slice(0, 300))
      return internalError()
  }
}

function ownerMessage(error: DbError, fallback: string): string {
  const message = error.message.trim()
  return message ? message.slice(0, 500) : fallback
}
