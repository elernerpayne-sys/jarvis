/**
 * What is waiting on Home: approvals Jarvis asked for this week and the
 * alerts that went out, each pointing at the call, task or shop it is about.
 */
import type { Alert, Approval, Call, Settings, Shop, Task } from '@/lib/types'

import { approvalAlert, buildAlert, callProblemAlert, taskDoneAlert, taskFailedAlert } from '../alerts'
import type { AlertInput } from '../alerts'
import type { Ids } from '../ids'
import { addDays, addMinutes, atHour, clockTime, iso, isSameDay, startOfDay } from '../time'
import type { CodeSeed } from './code'
import { pausedSince } from './receptionist'
import type { LateCancellation } from './receptionist'
import { SHOP_PROFILES } from './shops'

/** How many of the newest alerts are still unread when the app opens. */
const UNREAD = 4

export interface HomeContext {
  now: Date
  ids: Ids
  settings: Settings
  shops: Shop[]
  calls: Call[]
  tasks: Task[]
  code: CodeSeed
  lateCancellation: LateCancellation | null
}

interface ApprovalDraft {
  kind: Approval['kind']
  title: string
  detail: string
  shop_id: string | null
  status: Approval['status']
  requestedAt: Date
  decidedAt?: Date
  expiresAt?: Date
}

function toApproval(id: string, draft: ApprovalDraft): Approval {
  return {
    id,
    kind: draft.kind,
    title: draft.title,
    detail: draft.detail,
    task_id: null,
    shop_id: draft.shop_id,
    status: draft.status,
    requested_at: iso(draft.requestedAt),
    decided_at: draft.decidedAt ? iso(draft.decidedAt) : null,
    expires_at: draft.expiresAt ? iso(draft.expiresAt) : null,
    created_at: iso(draft.requestedAt),
  }
}

function lateFeeApproval(late: LateCancellation): ApprovalDraft {
  const { call, appointment } = late
  const askedAt = new Date(call.created_at)
  return {
    kind: 'receptionist',
    title: `Waive ${appointment.customer_name}’s $10 late-cancellation fee?`,
    detail: `He cancelled his ${clockTime(new Date(appointment.starts_at))} ${appointment.service.toLowerCase()} with ${appointment.barber ?? 'his barber'} inside the four-hour window because his work shift moved. He’s been a regular since June and has never missed a booking. Jarvis will text him your answer.`,
    shop_id: call.shop_id,
    status: 'pending',
    requestedAt: askedAt,
    // He was promised an answer the same day; leave room for the owner to see it.
    expiresAt: addMinutes(askedAt, 48 * 60),
  }
}

export function seedHome(context: HomeContext): { approvals: Approval[]; alerts: Alert[] } {
  const { now, ids, settings, shops, calls, tasks, code } = context
  const shopName = (id: string) => shops.find((shop) => shop.id === id)?.name ?? 'the shop'
  const [first, second] = SHOP_PROFILES

  const drafts: ApprovalDraft[] = [
    {
      kind: 'spend',
      title: 'Buy a new Austin phone number for $1.15 a month?',
      detail:
        'A second Twilio number, (737) 555-0119, just for Burnet Road’s reminder texts, so replies stop ringing the main line. Billed monthly; you can release it any time.',
      shop_id: second.id,
      status: 'pending',
      requestedAt: addMinutes(now, -190),
    },
    {
      kind: 'receptionist',
      title: 'Open at 7 AM on Saturday for a wedding party of six?',
      detail:
        'Andre Whitfield asked for six cuts before a 10 AM ceremony. It would need two barbers in an hour before opening.',
      shop_id: first.id,
      status: 'denied',
      requestedAt: atHour(addDays(startOfDay(now), -2), 15.2),
      decidedAt: atHour(addDays(startOfDay(now), -2), 16.1),
    },
    {
      kind: 'receptionist',
      title: 'Refund Ian McAllister’s $10 deposit after he rescheduled twice?',
      detail:
        'He moved his booking twice because of work travel and asked for the deposit back instead of keeping it as credit.',
      shop_id: second.id,
      status: 'expired',
      requestedAt: atHour(addDays(startOfDay(now), -4), 11.5),
      expiresAt: atHour(addDays(startOfDay(now), -3), 11.5),
    },
    {
      kind: 'spend',
      title: 'Top up the Twilio balance by $20?',
      detail: 'The balance was down to $4.80, about two days of calls and texts at this week’s pace.',
      shop_id: null,
      status: 'approved',
      requestedAt: atHour(addDays(startOfDay(now), -5), 9.4),
      decidedAt: atHour(addDays(startOfDay(now), -5), 9.6),
    },
  ]
  if (context.lateCancellation) drafts.unshift(lateFeeApproval(context.lateCancellation))

  const approvals = [
    ...code.approvals,
    ...drafts.map((draft) => toApproval(ids.next('approval'), draft)),
  ].sort((a, b) => b.requested_at.localeCompare(a.requested_at))

  // ── Alerts ────────────────────────────────────────────────────────────────
  const raised: Array<{ input: AlertInput; at: Date }> = []

  for (const approval of approvals.filter((item) => item.status === 'pending')) {
    const headline =
      approval.kind === 'code'
        ? 'A code change is ready to push'
        : approval.kind === 'spend'
          ? 'Jarvis wants to spend money'
          : `A caller at ${shopName(approval.shop_id ?? '')} needs your answer`
    raised.push({ input: approvalAlert(approval, headline), at: new Date(approval.requested_at) })
  }

  const newestFirst = [...calls].sort((a, b) => b.started_at.localeCompare(a.started_at))
  const today = (call: Call) => isSameDay(new Date(call.started_at), now)
  const problemCalls = [
    newestFirst.find((call) => call.outcome === 'missed' && today(call)),
    newestFirst.find((call) => call.outcome === 'failed' && today(call)),
    newestFirst.find((call) => call.outcome === 'missed' && !today(call)),
  ]
  for (const call of problemCalls) {
    if (call) {
      raised.push({ input: callProblemAlert(call, shopName(call.shop_id)), at: new Date(call.created_at) })
    }
  }

  for (const task of tasks) {
    if (!task.finished_at) continue
    if (task.status === 'done') raised.push({ input: taskDoneAlert(task), at: new Date(task.finished_at) })
    if (task.status === 'failed') raised.push({ input: taskFailedAlert(task), at: new Date(task.finished_at) })
  }

  for (const profile of SHOP_PROFILES) {
    const since = pausedSince(profile, now)
    if (!since) continue
    raised.push({
      input: {
        type: 'system',
        title: `Jarvis is paused at ${profile.name}`,
        body: 'Calls to this line now ring the front desk. The call history is still here.',
        shop_id: profile.id,
      },
      at: since,
    })
  }

  const alerts = raised
    .filter(({ at }) => at.getTime() <= now.getTime())
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .map(({ input, at }, index) => {
      const alert = buildAlert(ids.next('alert'), input, settings, at)
      if (index >= UNREAD) {
        alert.read_at = iso(new Date(Math.min(addMinutes(at, 18).getTime(), now.getTime())))
      }
      return alert
    })

  return { approvals, alerts }
}
