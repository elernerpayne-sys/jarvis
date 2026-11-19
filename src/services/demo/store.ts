/**
 * The demo's database: every table as a plain array, held in memory. Rows on
 * the realtime tables only change through `insert` and `update`, which tell
 * every listener, the way Supabase realtime does for the live app.
 */
import type {
  Alert,
  Appointment,
  Approval,
  Call,
  CallSummary,
  ChangeEvent,
  ChangeType,
  Decision,
  HandbookEntry,
  RealtimeTable,
  Settings,
  Shop,
  Task,
  TaskEvent,
} from '@/lib/types'

import type { Ids } from './ids'

/** One array per table, named like the Postgres tables. */
export interface DemoData {
  shops: Shop[]
  calls: Call[]
  appointments: Appointment[]
  tasks: Task[]
  task_events: TaskEvent[]
  approvals: Approval[]
  alerts: Alert[]
  handbook_entries: HandbookEntry[]
  decisions: Decision[]
  settings: Settings
}

export type Row<T extends RealtimeTable> = DemoData[T][number]

export interface Store {
  /** The rows themselves. Read freely; change realtime tables through the store. */
  readonly data: DemoData
  readonly ids: Ids
  find<T extends RealtimeTable>(table: T, id: string): Row<T> | undefined
  insert<T extends RealtimeTable>(table: T, row: Row<T>): Row<T>
  /** Applies `changes` to the row. Returns undefined when there is no such row. */
  update<T extends RealtimeTable>(
    table: T,
    id: string,
    changes: Partial<Row<T>>,
  ): Row<T> | undefined
  /** Calls `listener` for every change on `tables`. Returns a function that stops it. */
  listen(tables: readonly RealtimeTable[], listener: (event: ChangeEvent) => void): () => void
}

/** A deep copy of plain row data, so callers can never reach into the store. */
export function copy<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => copy(item)) as T
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, copy(item)]),
    ) as T
  }
  return value
}

/** A call as lists and realtime carry it: everything but the transcript. */
export function toCallSummary(call: Call): CallSummary {
  return {
    id: call.id,
    shop_id: call.shop_id,
    external_id: call.external_id,
    caller_name: call.caller_name,
    caller_phone: call.caller_phone,
    started_at: call.started_at,
    duration_seconds: call.duration_seconds,
    outcome: call.outcome,
    summary: call.summary,
    created_at: call.created_at,
  }
}

export function createStore(data: DemoData, ids: Ids): Store {
  const listeners = new Set<{
    tables: ReadonlySet<RealtimeTable>
    notify: (event: ChangeEvent) => void
  }>()

  function rows<T extends RealtimeTable>(table: T): Array<Row<T>> {
    return data[table] as Array<Row<T>>
  }

  function announce<T extends RealtimeTable>(table: T, type: ChangeType, row: Row<T>): void {
    const publicRow = table === 'calls' ? toCallSummary(row as Call) : row
    for (const listener of [...listeners]) {
      if (!listener.tables.has(table)) continue
      // Each listener gets its own copy; one of them changing it must not
      // affect the store or the others.
      const event = { table, type, id: row.id, row: copy(publicRow) } as ChangeEvent
      try {
        listener.notify(event)
      } catch (error) {
        // A screen failing to handle an update must not stop the simulation.
        console.error('A demo realtime listener failed.', error)
      }
    }
  }

  return {
    data,
    ids,

    find(table, id) {
      return rows(table).find((row) => row.id === id)
    },

    insert(table, row) {
      rows(table).push(row)
      announce(table, 'INSERT', row)
      return row
    },

    update(table, id, changes) {
      const row = rows(table).find((candidate) => candidate.id === id)
      if (!row) return undefined
      Object.assign(row, changes)
      announce(table, 'UPDATE', row)
      return row
    },

    listen(tables, listener) {
      const entry = { tables: new Set(tables), notify: listener }
      listeners.add(entry)
      return () => {
        listeners.delete(entry)
      }
    },
  }
}
