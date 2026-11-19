/**
 * How an alert is routed. This mirrors the real webhook: the owner's
 * preference for that alert type decides the channel, and during quiet hours
 * a call or a text becomes in-app only.
 */
import { formatPhone, isWithinQuietHours } from '@/lib/format'
import type {
  Alert,
  AlertType,
  Approval,
  CallSummary,
  NotifyChannel,
  Settings,
  Task,
} from '@/lib/types'

import type { Store } from './store'
import { iso } from './time'

export function routeChannel(settings: Settings, type: AlertType, at: Date): NotifyChannel {
  const preferred = settings.notification_prefs[type]
  if (preferred === 'in_app' || !settings.quiet_hours_enabled) return preferred
  const quiet = isWithinQuietHours(
    settings.quiet_hours_start,
    settings.quiet_hours_end,
    settings.timezone,
    at,
  )
  return quiet ? 'in_app' : preferred
}

export interface AlertInput {
  type: AlertType
  title: string
  body?: string | null
  shop_id?: string | null
  call_id?: string | null
  task_id?: string | null
  approval_id?: string | null
}

/** Builds an unread alert, routed with the settings as they are at `at`. */
export function buildAlert(id: string, input: AlertInput, settings: Settings, at: Date): Alert {
  return {
    id,
    type: input.type,
    title: input.title,
    body: input.body ?? null,
    shop_id: input.shop_id ?? null,
    call_id: input.call_id ?? null,
    task_id: input.task_id ?? null,
    approval_id: input.approval_id ?? null,
    channel: routeChannel(settings, input.type, at),
    read_at: null,
    created_at: iso(at),
  }
}

/** Raises a new alert while the app is open. */
export function raiseAlert(store: Store, input: AlertInput, at: Date): Alert {
  return store.insert(
    'alerts',
    buildAlert(store.ids.next('alert'), input, store.data.settings, at),
  )
}

// ── What each kind of alert says ───────────────────────────────────────────

/** For a call that was missed or failed. */
export function callProblemAlert(call: CallSummary, shopName: string): AlertInput {
  const links = { shop_id: call.shop_id, call_id: call.id }
  if (call.outcome === 'failed') {
    return { type: 'failed_call', title: `A call failed at ${shopName}`, body: call.summary, ...links }
  }
  const phone = formatPhone(call.caller_phone)
  const who = call.caller_name ? `${call.caller_name}, ${phone}` : phone
  return {
    type: 'missed_call',
    title: `Missed call at ${shopName}`,
    body: call.summary ? `${who}. ${call.summary}` : who,
    ...links,
  }
}

export function taskDoneAlert(task: Task): AlertInput {
  return {
    type: 'task_done',
    title: `Finished: ${task.title}`,
    body: task.pr_url ? `The pull request is open in ${task.repo}.` : `Done in ${task.repo}.`,
    task_id: task.id,
  }
}

export function taskFailedAlert(task: Task): AlertInput {
  return { type: 'task_failed', title: `Failed: ${task.title}`, body: task.error, task_id: task.id }
}

/** `headline` is the short version for a toast; the body carries the question. */
export function approvalAlert(approval: Approval, headline: string): AlertInput {
  return {
    type: 'approval_needed',
    title: headline,
    body: approval.title,
    task_id: approval.task_id,
    approval_id: approval.id,
  }
}
