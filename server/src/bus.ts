/**
 * Row changes, fanned out to every open /app/events stream. Rows are shaped
 * exactly like the endpoints return them (calls without their transcript).
 */
import type { ChangeType, RealtimeTable } from '../../src/lib/types.ts'

export interface Change {
  table: RealtimeTable
  type: ChangeType
  id: string
  row: object | null
}

export type Listener = (change: Change) => void

export interface Bus {
  publish(change: Change): void
  subscribe(listener: Listener): () => void
  size(): number
}

export function createBus(): Bus {
  const listeners = new Set<Listener>()
  return {
    publish(change) {
      for (const listener of [...listeners]) {
        try {
          listener(change)
        } catch {
          // One broken stream must not stop the others.
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    size: () => listeners.size,
  }
}
