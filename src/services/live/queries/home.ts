import { localDate } from '@/lib/format'
import type { Alert, Approval } from '@/lib/types'
import type { JarvisService } from '@/services/types'

import { getClient } from '../client'
import { ALERT_COLUMNS, APPROVAL_COLUMNS } from '../columns'
import { many, maybeOne, none, todayRange } from '../db'

const APPROVAL_LIMIT = 200
const DEFAULT_ALERT_LIMIT = 50
const MAX_ALERT_LIMIT = 200

/** A count from the database, whatever numeric form it arrived in. */
function count(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export const home: Pick<
  JarvisService,
  'getBrief' | 'listApprovals' | 'listAlerts' | 'markAlertRead' | 'markAllAlertsRead'
> = {
  async getBrief() {
    const now = new Date()
    const result = await maybeOne<unknown>(getClient().rpc('get_brief', todayRange(now)))
    // A function that returns a table arrives as a one-row list, one that
    // returns a single record arrives as the record itself. Accept both.
    const first = Array.isArray(result) ? result[0] : result
    const counts = isRecord(first) ? first : {}
    return {
      date: localDate(now),
      calls_answered: count(counts.calls_answered),
      bookings_made: count(counts.bookings_made),
      missed_calls: count(counts.missed_calls),
      tasks_finished: count(counts.tasks_finished),
    }
  },

  async listApprovals(options) {
    let query = getClient().from('approvals').select(APPROVAL_COLUMNS)
    if (options?.status) query = query.eq('status', options.status)
    return many<Approval>(query.order('requested_at', { ascending: false }).limit(APPROVAL_LIMIT))
  },

  async listAlerts(options) {
    const limit = Math.min(Math.max(Math.trunc(options?.limit ?? DEFAULT_ALERT_LIMIT), 1), MAX_ALERT_LIMIT)
    return many<Alert>(
      getClient().from('alerts').select(ALERT_COLUMNS).order('created_at', { ascending: false }).limit(limit),
    )
  },

  async markAlertRead(id) {
    // Only unread alerts are touched, so the first time it was read is kept.
    await none(
      getClient().from('alerts').update({ read_at: new Date().toISOString() }).eq('id', id).is('read_at', null),
      { notFound: 'Couldn’t find that alert.' },
    )
  },

  async markAllAlertsRead() {
    await none(getClient().from('alerts').update({ read_at: new Date().toISOString() }).is('read_at', null))
  },
}
