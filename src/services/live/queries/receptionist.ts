import { PROBLEM_OUTCOMES } from '@/lib/types'
import type { Appointment, Call, CallSummary, ShopSummary } from '@/lib/types'
import type { JarvisService } from '@/services/types'

import { getClient } from '../client'
import { APPOINTMENT_COLUMNS, CALL_COLUMNS, CALL_SUMMARY_COLUMNS, SHOP_SUMMARY_COLUMNS } from '../columns'
import { many, one, todayRange } from '../db'

const APPOINTMENT_LIMIT = 200
const CALL_LIMIT = 200

/** One row per shop with today's counters, straight from the database function. */
function shopSummaries() {
  return getClient().rpc('get_shop_summaries', todayRange()).select(SHOP_SUMMARY_COLUMNS)
}

export const receptionist: Pick<
  JarvisService,
  'listShops' | 'getShop' | 'listUpcomingAppointments' | 'listCalls' | 'getCall'
> = {
  async listShops() {
    return many<ShopSummary>(shopSummaries().order('name', { ascending: true }))
  },

  async getShop(id) {
    return one<ShopSummary>(shopSummaries().eq('id', id).maybeSingle(), { notFound: 'Couldn’t find that shop.' })
  },

  async listUpcomingAppointments(shopId) {
    return many<Appointment>(
      getClient()
        .from('appointments')
        .select(APPOINTMENT_COLUMNS)
        .eq('shop_id', shopId)
        .gte('starts_at', new Date().toISOString())
        .neq('status', 'cancelled')
        .order('starts_at', { ascending: true })
        .limit(APPOINTMENT_LIMIT),
    )
  },

  async listCalls(shopId, options) {
    let query = getClient().from('calls').select(CALL_SUMMARY_COLUMNS).eq('shop_id', shopId)
    if (options?.filter === 'problems') query = query.in('outcome', [...PROBLEM_OUTCOMES])
    return many<CallSummary>(query.order('started_at', { ascending: false }).limit(CALL_LIMIT))
  },

  async getCall(id) {
    const call = await one<Call>(getClient().from('calls').select(CALL_COLUMNS).eq('id', id).maybeSingle(), {
      notFound: 'Couldn’t find that call.',
    })
    // A call that is still in progress may not have a transcript yet.
    return Array.isArray(call.transcript) ? call : { ...call, transcript: [] }
  },
}
