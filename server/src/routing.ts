/**
 * Alert routing (docs/backend.md, "Alert routing"): the owner's preference
 * for the alert type decides the channel; during quiet hours, or with no
 * phone number on file, a call or text becomes in_app.
 */
import type { AlertType, NotifyChannel, Settings } from '../../src/lib/types.ts'

export interface Notify {
  channel: NotifyChannel
  phone: string | null
  quiet_hours: boolean
}

export const ALERT_TYPES: readonly AlertType[] = [
  'missed_call',
  'failed_call',
  'approval_needed',
  'task_done',
  'task_failed',
  'system',
]

export const CHANNELS: readonly NotifyChannel[] = ['call', 'text', 'in_app']

export const DEFAULT_PREFS: Record<AlertType, NotifyChannel> = {
  missed_call: 'text',
  failed_call: 'text',
  approval_needed: 'text',
  task_done: 'in_app',
  task_failed: 'text',
  system: 'in_app',
}

function minutes(hhmm: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

/** Minutes past midnight on the wall clock of `timezone` (UTC when the zone is unknown). */
function localMinutes(now: Date, timezone: string): number {
  const read = (zone: string) => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
    const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0) % 24
    const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0)
    return hour * 60 + minute
  }
  try {
    return read(timezone)
  } catch {
    return read('UTC')
  }
}

/** Start included, end not; may run overnight; equal times mean never. */
export function inQuietHours(now: Date, timezone: string, start: string, end: string): boolean {
  const from = minutes(start)
  const to = minutes(end)
  if (from === null || to === null || from === to) return false
  const current = localMinutes(now, timezone)
  return from < to ? current >= from && current < to : current >= from || current < to
}

export function routeAlert(settings: Settings | null, type: AlertType, now: Date = new Date()): Notify {
  if (!settings) return { channel: 'in_app', phone: null, quiet_hours: false }
  const preferred = settings.notification_prefs?.[type]
  let channel: NotifyChannel = CHANNELS.includes(preferred) ? preferred : 'in_app'
  const quiet =
    settings.quiet_hours_enabled &&
    inQuietHours(now, settings.timezone, settings.quiet_hours_start, settings.quiet_hours_end)
  if (channel !== 'in_app' && (quiet || !settings.notify_phone)) channel = 'in_app'
  return { channel, phone: settings.notify_phone, quiet_hours: quiet }
}
