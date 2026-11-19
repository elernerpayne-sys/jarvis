/**
 * A small seeded random number generator (mulberry32). The demo never calls
 * Math.random, so the same seed always builds the same sample data and tests
 * can rely on it.
 */
export interface Random {
  /** A number from 0 up to, but not including, 1. */
  next(): number
  /** A whole number from `min` to `max`, both included. */
  int(min: number, max: number): number
  /** True with the given probability (0 to 1). */
  chance(probability: number): boolean
  pick<T>(items: readonly T[]): T
  /** Picks a key, more often the heavier it is: `{ booked: 5, missed: 1 }`. */
  weighted<K extends string>(weights: Readonly<Record<K, number>>): K
  /** A shuffled copy. */
  shuffle<T>(items: readonly T[]): T[]
  /** Random lowercase hex, for provider-style ids. */
  hex(length: number): string
}

export function createRandom(seed: number): Random {
  let state = seed >>> 0

  function next(): number {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  function int(min: number, max: number): number {
    return min + Math.floor(next() * (max - min + 1))
  }

  function pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Cannot pick from an empty list.')
    return items[int(0, items.length - 1)]
  }

  function weighted<K extends string>(weights: Readonly<Record<K, number>>): K {
    const entries = Object.entries(weights) as Array<[K, number]>
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0)
    let roll = next() * total
    for (const [key, weight] of entries) {
      roll -= weight
      if (roll < 0) return key
    }
    return entries[entries.length - 1][0]
  }

  function shuffle<T>(items: readonly T[]): T[] {
    const result = [...items]
    for (let i = result.length - 1; i > 0; i--) {
      const j = int(0, i)
      ;[result[i], result[j]] = [result[j], result[i]]
    }
    return result
  }

  function hex(length: number): string {
    let out = ''
    while (out.length < length) out += int(0, 15).toString(16)
    return out
  }

  return { next, int, chance: (probability) => next() < probability, pick, weighted, shuffle, hex }
}
