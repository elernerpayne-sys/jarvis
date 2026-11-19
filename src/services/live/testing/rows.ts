/**
 * One complete row of each kind, for tests only. They are typed with the
 * domain types, so a field added to lib/types.ts has to be added here too,
 * and the tests then check that the live service asks the database for it.
 */
import type {
  Alert,
  Appointment,
  Approval,
  Call,
  CallSummary,
  Decision,
  HandbookEntry,
  Settings,
  ShopSummary,
  Task,
  TaskEvent,
} from '@/lib/types'

export const shop: ShopSummary = {
  id: 'shop-1',
  name: 'Eastside Barbers',
  phone: '+15125550142',
  address: '1804 E 6th St, Austin, TX',
  timezone: 'America/Chicago',
  status: 'active',
  created_at: '2026-09-01T15:00:00.000Z',
  calls_today: 14,
  bookings_today: 6,
  missed_today: 1,
  next_appointment_at: '2026-11-19T21:30:00.000Z',
}

export const appointment: Appointment = {
  id: 'appt-1',
  shop_id: 'shop-1',
  external_id: 'sq-88213',
  call_id: 'call-1',
  customer_name: 'Marcus Reed',
  customer_phone: '+15125550177',
  service: 'Skin fade',
  barber: 'Dre',
  starts_at: '2026-11-19T21:30:00.000Z',
  duration_minutes: 45,
  status: 'booked',
  source: 'jarvis',
  notes: null,
  created_at: '2026-11-19T16:02:00.000Z',
}

export const callSummary: CallSummary = {
  id: 'call-1',
  shop_id: 'shop-1',
  external_id: 'CA1f0c',
  caller_name: 'Marcus Reed',
  caller_phone: '+15125550177',
  started_at: '2026-11-19T16:00:00.000Z',
  duration_seconds: 96,
  outcome: 'booked',
  summary: 'Booked a skin fade with Dre for 3:30.',
  created_at: '2026-11-19T16:00:00.000Z',
}

export const call: Call = {
  ...callSummary,
  transcript: [
    { role: 'agent', text: 'Eastside Barbers, this is Jarvis. How can I help?', t: 0 },
    { role: 'caller', text: 'Can I get a fade with Dre this afternoon?', t: 4 },
  ],
}

export const task: Task = {
  id: 'task-1',
  external_id: 'jv-301',
  title: 'Fix the double-booking bug on the booking site',
  repo: 'monserrat/booking-site',
  instructions: 'Fix the double-booking bug on the booking site.\nAdd a test.',
  status: 'running',
  branch: 'jarvis/fix-double-booking',
  result_summary: null,
  pr_url: null,
  error: null,
  created_at: '2026-11-19T14:00:00.000Z',
  updated_at: '2026-11-19T14:05:00.000Z',
  started_at: '2026-11-19T14:01:00.000Z',
  finished_at: null,
}

export function taskEvent(id: string, message: string, createdAt: string): TaskEvent {
  return { id, task_id: 'task-1', kind: 'log', message, created_at: createdAt }
}

export const approval: Approval = {
  id: 'approval-1',
  kind: 'code',
  title: 'Push the booking fix and open a pull request?',
  detail: '3 files changed in booking-site.',
  task_id: 'task-1',
  shop_id: null,
  status: 'pending',
  requested_at: '2026-11-19T14:20:00.000Z',
  decided_at: null,
  expires_at: null,
  created_at: '2026-11-19T14:20:00.000Z',
}

export const alert: Alert = {
  id: 'alert-1',
  type: 'missed_call',
  title: 'Missed call at Eastside Barbers',
  body: 'The caller hung up before the greeting.',
  shop_id: 'shop-1',
  call_id: 'call-2',
  task_id: null,
  approval_id: null,
  channel: 'text',
  read_at: null,
  created_at: '2026-11-19T17:10:00.000Z',
}

export const handbookEntry: HandbookEntry = {
  id: 'entry-1',
  title: 'Walk-in policy',
  category: 'Policies',
  content: 'Walk-ins are welcome before noon.\nAfter noon, appointments only.',
  tags: ['walk-ins', 'hours'],
  notion_page_id: null,
  created_at: '2026-10-02T15:00:00.000Z',
  updated_at: '2026-11-10T15:00:00.000Z',
}

export const decision: Decision = {
  id: 'decision-1',
  title: 'Raise the fade price',
  decision: 'Skin fades go from $35 to $40 on December 1.',
  rationale: 'Every chair is booked two weeks out.',
  decided_on: '2026-11-12',
  tags: ['pricing'],
  notion_page_id: null,
  created_at: '2026-11-12T18:00:00.000Z',
  updated_at: '2026-11-12T18:00:00.000Z',
}

export const settings: Settings = {
  id: 'settings-1',
  owner_id: 'owner-1',
  notify_phone: '+15125550100',
  notification_prefs: {
    missed_call: 'text',
    failed_call: 'text',
    approval_needed: 'call',
    task_done: 'in_app',
    task_failed: 'text',
    system: 'in_app',
  },
  quiet_hours_enabled: true,
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:00',
  timezone: 'America/Chicago',
  allowed_repos: ['monserrat/booking-site', 'monserrat/jarvis'],
  updated_at: '2026-11-18T03:00:00.000Z',
}
