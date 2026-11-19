/**
 * How each status reads on screen: the word and the tone of its dot.
 * Kept in one place so Home, Receptionist and Code always agree.
 */
import type {
  AlertType,
  AppointmentStatus,
  ApprovalKind,
  CallOutcome,
  ConnectionState,
  NotifyChannel,
  ServiceKey,
  TaskStatus,
} from '@/lib/types'

/** amber = Jarvis is on it / needs you, ok = went well, bad = went wrong. */
export type Tone = 'amber' | 'ok' | 'bad' | 'neutral'

export interface StatusMeta {
  label: string
  tone: Tone
  /** The dot pulses while something is in progress. */
  pulse?: boolean
}

export const TASK_STATUS: Record<TaskStatus, StatusMeta> = {
  queued: { label: 'Queued', tone: 'neutral' },
  running: { label: 'Running', tone: 'amber', pulse: true },
  needs_approval: { label: 'Needs approval', tone: 'amber' },
  done: { label: 'Done', tone: 'ok' },
  failed: { label: 'Failed', tone: 'bad' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
}

export const CALL_OUTCOME: Record<CallOutcome, StatusMeta> = {
  booked: { label: 'Booked', tone: 'ok' },
  answered: { label: 'Answered', tone: 'neutral' },
  message: { label: 'Took a message', tone: 'neutral' },
  transferred: { label: 'Transferred', tone: 'neutral' },
  missed: { label: 'Missed', tone: 'bad' },
  failed: { label: 'Failed', tone: 'bad' },
}

export const APPOINTMENT_STATUS: Record<AppointmentStatus, StatusMeta> = {
  booked: { label: 'Booked', tone: 'neutral' },
  confirmed: { label: 'Confirmed', tone: 'ok' },
  completed: { label: 'Completed', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'bad' },
  no_show: { label: 'No-show', tone: 'bad' },
}

export const CONNECTION_STATE: Record<ConnectionState, StatusMeta> = {
  connected: { label: 'Connected', tone: 'ok' },
  not_configured: { label: 'Not set up', tone: 'neutral' },
  error: { label: 'Not working', tone: 'bad' },
}

export const SERVICE_LABEL: Record<ServiceKey, string> = {
  elevenlabs: 'ElevenLabs',
  twilio: 'Twilio',
  notion: 'Notion',
  jarvis: 'Jarvis backend',
}

/** What each service is for, in the owner's words. */
export const SERVICE_PURPOSE: Record<ServiceKey, string> = {
  elevenlabs: 'Jarvis’s voice',
  twilio: 'Shop phone lines',
  notion: 'Handbook sync',
  jarvis: 'Coding tasks',
}

export const APPROVAL_KIND_LABEL: Record<ApprovalKind, string> = {
  code: 'Code',
  receptionist: 'Receptionist',
  spend: 'Spending',
  other: 'Other',
}

export const ALERT_TYPE_LABEL: Record<AlertType, string> = {
  missed_call: 'Missed calls',
  failed_call: 'Failed calls',
  approval_needed: 'Approvals',
  task_done: 'Finished tasks',
  task_failed: 'Failed tasks',
  system: 'System problems',
}

/** One line under each alert type in Settings. */
export const ALERT_TYPE_HINT: Record<AlertType, string> = {
  missed_call: 'A caller could not get through.',
  failed_call: 'A call started but broke off.',
  approval_needed: 'Jarvis is waiting for your go-ahead.',
  task_done: 'A coding task finished.',
  task_failed: 'A coding task stopped with an error.',
  system: 'A connection or service is down.',
}

export const ALERT_TONE: Record<AlertType, Tone> = {
  missed_call: 'bad',
  failed_call: 'bad',
  approval_needed: 'amber',
  task_done: 'ok',
  task_failed: 'bad',
  system: 'bad',
}

export const CHANNEL_LABEL: Record<NotifyChannel, string> = {
  call: 'Call me',
  text: 'Text me',
  in_app: 'In-app only',
}
