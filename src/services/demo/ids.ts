/**
 * Readable, predictable ids for sample rows: "call-0042", "task-0003". The
 * real backend uses UUIDs; the app treats ids as opaque strings either way.
 */
export interface Ids {
  next(prefix: string): string
}

export function createIds(): Ids {
  const counters = new Map<string, number>()
  return {
    next(prefix) {
      const count = (counters.get(prefix) ?? 0) + 1
      counters.set(prefix, count)
      return `${prefix}-${String(count).padStart(4, '0')}`
    },
  }
}
