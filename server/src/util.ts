/** Small helpers shared across the server. */
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'

export const newId = (): string => randomUUID()

export const nowIso = (): string => new Date().toISOString()

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Any ISO-8601 time with a timezone, normalised to UTC with milliseconds. Null when it isn't one. */
const ISO_TIME = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?([Zz]|[+-]\d{2}(:?\d{2})?)$/
export function toIso(value: unknown): string | null {
  if (typeof value !== 'string' || !ISO_TIME.test(value)) return null
  const ms = Date.parse(value.replace(' ', 'T'))
  return Number.isNaN(ms) ? null : new Date(ms).toISOString()
}

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export const E164 = /^\+[1-9][0-9]{6,14}$/

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** Constant-time string comparison (hashes first, so lengths never leak). */
export function safeEqual(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest()
  const right = createHash('sha256').update(b).digest()
  return timingSafeEqual(left, right)
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Trimmed, without blanks or repeats, in the order given. */
export function cleanList(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value !== ''))]
}

/** A short title from the first line (kept in step with titleFromInstructions in src/lib/format.ts). */
export function titleFromInstructions(instructions: string, max = 72): string {
  const firstLine = instructions.trim().split(/\r?\n/)[0]?.trim() ?? ''
  if (firstLine.length <= max) return firstLine || 'Untitled task'
  const cut = firstLine.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

/** "+15125550142" → "(512) 555-0142" for US numbers; anything else as given. */
export function formatPhone(phone: string | null): string {
  if (!phone) return 'an unknown number'
  const us = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(phone)
  return us ? `(${us[1]}) ${us[2]}-${us[3]}` : phone
}

/** For log lines: a message without anything that looks like a secret. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 300)
  return String(error).slice(0, 300)
}

const quiet = () => process.env.JARVIS_LOG === 'silent'

export function log(message: string): void {
  if (quiet()) return
  console.log(`[jarvis] ${new Date().toISOString()} ${message}`)
}

export function logError(message: string, error?: unknown): void {
  if (quiet() && process.env.JARVIS_LOG_ERRORS !== '1') return
  console.error(`[jarvis] ${new Date().toISOString()} ${message}${error === undefined ? '' : ` (${describeError(error)})`}`)
}
