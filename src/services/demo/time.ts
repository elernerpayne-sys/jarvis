/**
 * Clock helpers for building sample data relative to "now". Everything works
 * in the device's local time, the same way the screens show it.
 */

export const SECOND = 1000
export const MINUTE = 60 * SECOND
export const HOUR = 60 * MINUTE

export const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

export function iso(date: Date): string {
  return date.toISOString()
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/** Same clock time, `days` calendar days later (earlier when negative). */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MINUTE)
}

export function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * SECOND)
}

/** `hour` o'clock on the given day; 16.5 is 4:30 PM. */
export function atHour(day: Date, hour: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, Math.round(hour * 60))
}

export function isSameDay(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() === startOfDay(b).getTime()
}

/** Whole calendar days from `from` to `target`. */
export function daysBetween(target: Date, from: Date): number {
  return Math.round((startOfDay(target).getTime() - startOfDay(from).getTime()) / (24 * HOUR))
}

/**
 * A time the way it is said on a call: "2:30 PM", "10 AM". Written by hand
 * rather than with toLocaleTimeString so transcripts read the same on every
 * device.
 */
export function clockTime(date: Date): string {
  const hours = date.getHours()
  const minutes = date.getMinutes()
  const hour12 = hours % 12 === 0 ? 12 : hours % 12
  const suffix = hours < 12 ? 'AM' : 'PM'
  return minutes === 0
    ? `${hour12} ${suffix}`
    : `${hour12}:${String(minutes).padStart(2, '0')} ${suffix}`
}

/** A decimal hour as a spoken time: 9 → "9 AM", 16.5 → "4:30 PM". */
export function hourLabel(hour: number): string {
  return clockTime(atHour(new Date(2000, 0, 1), hour))
}

/** The day as someone on the phone would say it: "today", "tomorrow", "Saturday". */
export function dayWord(target: Date, from: Date): string {
  const days = daysBetween(target, from)
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  return WEEKDAYS[target.getDay()]
}
