/**
 * Formatting helpers. Everything a screen prints about time, duration or a
 * phone number goes through here so it reads the same everywhere.
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function toDate(value: string | number | Date): Date {
  return value instanceof Date ? value : new Date(value)
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/** Whole calendar days from `now` to `date` (negative for the past). */
function dayDiff(date: Date, now: Date): number {
  const a = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return Math.round((a - b) / DAY)
}

/** "3:05 PM" */
export function formatTime(value: string | number | Date): string {
  return toDate(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** "Today", "Tomorrow", "Yesterday", "Thursday" (within a week), else "Nov 19". */
export function formatDay(value: string | number | Date, now: Date = new Date()): string {
  const date = toDate(value)
  const diff = dayDiff(date, now)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  if (diff > 1 && diff < 7) return date.toLocaleDateString([], { weekday: 'long' })
  const sameYear = date.getFullYear() === now.getFullYear()
  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

/** "Today, 3:05 PM" / "Nov 19, 3:05 PM" */
export function formatDayTime(value: string | number | Date, now: Date = new Date()): string {
  return `${formatDay(value, now)}, ${formatTime(value)}`
}

/** "Thursday, November 19" — the long date in the Home header. */
export function formatLongDate(value: string | number | Date = new Date()): string {
  return toDate(value).toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

/**
 * Compact time for the right edge of a list row.
 * "Just now", "4m ago", "2h ago", then "Yesterday", then "Nov 12".
 */
export function formatRelative(value: string | number | Date, now: Date = new Date()): string {
  const date = toDate(value)
  const elapsed = now.getTime() - date.getTime()
  if (elapsed < 0) {
    // In the future: say when, not how long.
    return isSameDay(date, now) ? formatTime(date) : formatDay(date, now)
  }
  if (elapsed < MINUTE) return 'Just now'
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`
  if (elapsed < 12 * HOUR || isSameDay(date, now)) return `${Math.floor(elapsed / HOUR)}h ago`
  return formatDay(date, now)
}

/** Call or task length: "42s", "3m 05s", "1h 12m". */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

/** Offset inside a transcript: "0:07", "12:40". */
export function formatTimecode(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** "+15125550142" → "(512) 555-0142". Anything else is returned as given. */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return ''
  const digits = phone.replace(/\D/g, '')
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  if (national.length === 10 && (phone.startsWith('+1') || !phone.startsWith('+'))) {
    return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`
  }
  return phone
}

/** "HH:MM" (24-hour) → "10:00 PM". */
export function formatClock(hhmm: string): string {
  const [hours, minutes] = hhmm.split(':').map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return hhmm
  const date = new Date(2000, 0, 1, hours, minutes)
  return formatTime(date)
}

/** Start (inclusive) and end (exclusive) of the local calendar day. */
export function dayBounds(now: Date = new Date()): { from: Date; to: Date } {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return { from, to }
}

/** Local calendar date as "YYYY-MM-DD". */
export function localDate(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** "YYYY-MM-DD" → "Nov 19, 2026" without timezone drift. */
export function formatDateOnly(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  if (!y || !m || !d) return ymd
  return new Date(y, m - 1, d).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function greeting(now: Date = new Date()): string {
  const hour = now.getHours()
  if (hour < 5) return 'Still up.'
  if (hour < 12) return 'Good morning.'
  if (hour < 18) return 'Good afternoon.'
  return 'Good evening.'
}

/** "1 call" / "3 calls" */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

/** A short task title from free-form instructions: first line, trimmed to fit. */
export function titleFromInstructions(instructions: string, max = 72): string {
  const firstLine = instructions.trim().split(/\r?\n/)[0]?.trim() ?? ''
  if (firstLine.length <= max) return firstLine || 'Untitled task'
  const cut = firstLine.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

/**
 * True when `now` falls inside quiet hours. Both times are "HH:MM" in the
 * given IANA timezone; the window may run overnight (22:00 → 07:00).
 */
export function isWithinQuietHours(
  start: string,
  end: string,
  timezone: string,
  now: Date = new Date(),
): boolean {
  const toMinutes = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number)
    return h * 60 + m
  }
  let current: number
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now)
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
    current = h * 60 + m
  } catch {
    current = now.getHours() * 60 + now.getMinutes()
  }
  const from = toMinutes(start)
  const to = toMinutes(end)
  if (from === to) return false
  return from < to ? current >= from && current < to : current >= from || current < to
}
