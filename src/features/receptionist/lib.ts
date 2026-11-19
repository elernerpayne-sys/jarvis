/** Small pure helpers for the Receptionist screens. */
import { formatDay, formatPhone, formatRelative, localDate, plural } from '@/lib/format'
import type { CallOutcome, CallSummary, ShopSummary, Timestamp } from '@/lib/types'

/** How a caller is named on screen: their name, or the number when we don't have one. */
export function callerLabel(call: Pick<CallSummary, 'caller_name' | 'caller_phone'>): string {
  return call.caller_name?.trim() || formatPhone(call.caller_phone) || 'Unknown caller'
}

/**
 * When a call came in, for the right edge of its row: how long ago for
 * today's calls ("20m ago"), the day for older ones ("Yesterday", "Nov 12").
 */
export function callTime(startedAt: Timestamp, now: Date): string {
  const sameDay = localDate(new Date(startedAt)) === localDate(now)
  return sameDay ? formatRelative(startedAt, now) : formatDay(startedAt, now)
}

/** A `tel:` link for a number, whatever punctuation it arrived with. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`
}

/**
 * Today across every shop, as one sentence:
 * "26 calls today across 3 shops, 3 missed."
 */
export function todaySentence(shops: readonly ShopSummary[]): string {
  const calls = shops.reduce((total, shop) => total + shop.calls_today, 0)
  const missed = shops.reduce((total, shop) => total + shop.missed_today, 0)
  if (calls === 0) return 'No calls yet today.'
  const where = shops.length === 1 ? '' : ` across ${shops.length} shops`
  const missedClause = missed > 0 ? `, ${missed} missed` : ''
  return `${plural(calls, 'call')} today${where}${missedClause}.`
}

export interface DayGroup<T> {
  /** Local calendar date, "YYYY-MM-DD". */
  day: string
  /** The first item's timestamp, for printing the day's heading. */
  at: Timestamp
  items: T[]
}

/** Splits items into local calendar days, keeping the order they came in. */
export function groupByDay<T>(items: readonly T[], timestampOf: (item: T) => Timestamp): DayGroup<T>[] {
  const groups = new Map<string, DayGroup<T>>()
  for (const item of items) {
    const at = timestampOf(item)
    const day = localDate(new Date(at))
    const group = groups.get(day)
    if (group) group.items.push(item)
    else groups.set(day, { day, at, items: [item] })
  }
  return [...groups.values()]
}

/** What to say where the transcript would be when a call has none. */
export function noTranscriptCopy(outcome: CallOutcome): string {
  if (outcome === 'missed') return 'No conversation. The caller hung up before Jarvis could answer.'
  if (outcome === 'failed') return 'No conversation. The call dropped before anyone spoke.'
  return 'No transcript for this call yet.'
}
