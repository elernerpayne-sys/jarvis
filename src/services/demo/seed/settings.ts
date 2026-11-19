/**
 * The owner's settings and what the connection check finds. Edit the phone
 * number, quiet hours or repos here.
 */
import { formatPhone } from '@/lib/format'
import { DEFAULT_NOTIFICATION_PREFS } from '@/lib/types'
import type { ConnectionStatus, Settings } from '@/lib/types'

import { addDays, iso } from '../time'
import { ALLOWED_REPOS } from './code'

function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago'
  } catch {
    return 'America/Chicago'
  }
}

export function seedSettings(now: Date): Settings {
  return {
    id: 'settings-1',
    owner_id: 'demo-owner',
    notify_phone: '+15125550100',
    notification_prefs: { ...DEFAULT_NOTIFICATION_PREFS },
    quiet_hours_enabled: true,
    quiet_hours_start: '22:00',
    quiet_hours_end: '07:00',
    timezone: deviceTimezone(),
    allowed_repos: [...ALLOWED_REPOS],
    updated_at: iso(addDays(now, -9)),
  }
}

/** One entry per service, in SERVICE_KEYS order. */
export function connectionStatuses(now: Date, shopLines: readonly string[]): ConnectionStatus[] {
  const checked_at = iso(now)
  const lines = shopLines.length === 1 ? '1 shop line' : `${shopLines.length} shop lines`
  const twilio =
    shopLines.length === 0
      ? 'Connected. No shop lines are forwarded to Jarvis yet.'
      : `Forwarding ${lines} to Jarvis: ${shopLines.map(formatPhone).join(', ')}.`
  return [
    {
      service: 'elevenlabs',
      state: 'connected',
      detail: 'The receptionist voice agent is live and answering.',
      latency_ms: 182,
      checked_at,
    },
    {
      service: 'twilio',
      state: 'connected',
      detail: twilio,
      latency_ms: 96,
      checked_at,
    },
    {
      service: 'notion',
      state: 'not_configured',
      detail: 'Not set up yet. Add a Notion key to sync the handbook and decisions.',
      latency_ms: null,
      checked_at,
    },
    {
      service: 'jarvis',
      state: 'connected',
      detail: 'The coding backend accepted the key and is taking tasks.',
      latency_ms: 241,
      checked_at,
    },
  ]
}
