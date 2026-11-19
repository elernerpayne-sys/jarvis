/**
 * A week at the shops: every call from six days ago until a minute ago, and
 * every appointment from then until five days from now. Built relative to
 * "now", so today always has calls whatever the clock says.
 */
import type { Appointment, AppointmentStatus, Call, CallOutcome, Shop } from '@/lib/types'

import type { CallWriter } from '../calls'
import type { Ids } from '../ids'
import type { Random } from '../random'
import { createSchedule } from '../schedule'
import type { Schedule } from '../schedule'
import { HOUR, MINUTE, addDays, addMinutes, atHour, iso, startOfDay } from '../time'
import type { Cast } from './people'
import { SERVICES, SERVICE_MIX, SHOP_PROFILES, openHours } from './shops'
import type { ShopProfile } from './shops'

/** How far back the call log goes, and how far ahead the calendar. */
const DAYS_OF_HISTORY = 6
const DAYS_AHEAD = 5

/** How calls end on an ordinary day. */
const USUAL_MIX: Record<CallOutcome, number> = {
  booked: 44,
  answered: 28,
  message: 7,
  transferred: 6,
  missed: 10,
  failed: 5,
}

/**
 * Today is laid out by hand first, so Home always has something to show:
 * problems lead each list, which keeps them in even when the day is minutes
 * old and only a couple of calls fit. Across the shops that is at least two
 * missed calls and one failed call.
 */
const TODAY_FIRST: { busy: readonly CallOutcome[]; quiet: readonly CallOutcome[] } = {
  busy: ['missed', 'failed', 'booked', 'answered', 'message', 'transferred', 'booked'],
  quiet: ['missed', 'booked', 'answered', 'booked'],
}
/** The rest of today's calls go well: no more problems than the ones above. */
const TODAY_REST = { booked: 58, answered: 34, message: 4, transferred: 4 } as const

export interface SeedContext {
  now: Date
  rng: Random
  ids: Ids
  cast: Cast
  writer: CallWriter
}

/** The late-cancellation call and the appointment it gave up (see Home). */
export interface LateCancellation {
  call: Call
  appointment: Appointment
}

export interface ReceptionistSeed {
  shops: Shop[]
  calls: Call[]
  appointments: Appointment[]
  lateCancellation: LateCancellation | null
}

type Planned =
  | { kind: 'call'; profile: ShopProfile; outcome: CallOutcome; endedAt: Date }
  | { kind: 'late-cancellation'; profile: ShopProfile; endedAt: Date; appointmentAt: Date }

export function toShop(profile: ShopProfile, now: Date): Shop {
  return {
    id: profile.id,
    name: profile.name,
    phone: profile.phone,
    address: profile.address,
    timezone: profile.timezone,
    status: profile.status,
    created_at: iso(addDays(now, -profile.joinedDaysAgo)),
  }
}

/** When Jarvis stopped answering at a paused shop: 5 PM that day. */
export function pausedSince(profile: ShopProfile, now: Date): Date | null {
  if (profile.pausedDaysAgo === null) return null
  return atHour(addDays(startOfDay(now), -profile.pausedDaysAgo), 17)
}

/** `count` moments between `from` and `to`, evenly spread with some jitter. */
function spread(from: number, to: number, count: number, rng: Random): Date[] {
  const span = Math.max(0, to - from)
  return Array.from({ length: count }, (_, index) => {
    return new Date(from + ((index + rng.next()) / count) * span)
  })
}

/** Today's calls: from opening time until a minute ago, never later. */
function planToday(profile: ShopProfile, now: Date, rng: Random): Planned[] {
  if (!profile.callsToday) return []
  const { open, close } = openHours(profile, now)
  const latest = now.getTime() - MINUTE
  const dayStart = startOfDay(now).getTime()

  // Early in the day there is no "since opening" yet: count from midnight,
  // when Jarvis was already picking up, and keep the day light.
  const wellUnderWay = now.getTime() >= open.getTime() + 2 * HOUR
  const from = wellUnderWay ? open.getTime() + 5 * MINUTE : Math.min(dayStart + MINUTE, latest)
  const [fewest, most] = profile.callsToday
  const wanted = wellUnderWay ? rng.int(fewest, most) : fewest
  const count = Math.min(wanted, Math.max(2, Math.floor((latest - from) / (4 * MINUTE))))

  // Most calls come while the shop is open; a few after closing.
  const duringHours = Math.min(latest, close.getTime())
  const afterHours =
    latest > close.getTime() + 20 * MINUTE ? Math.max(1, Math.round(count * 0.15)) : 0
  const times = [
    ...spread(from, duringHours, count - afterHours, rng),
    ...spread(close.getTime(), latest, afterHours, rng),
  ]

  const first = most >= 10 ? TODAY_FIRST.busy : TODAY_FIRST.quiet
  const outcomes: CallOutcome[] = first.slice(0, count)
  while (outcomes.length < count) outcomes.push(rng.weighted(TODAY_REST))

  const shuffled = rng.shuffle(outcomes)
  return times.map((endedAt, index) => ({
    kind: 'call',
    profile,
    outcome: shuffled[index],
    endedAt,
  }))
}

/** One earlier day: mostly during opening hours, a few in the evening. */
function planPastDay(profile: ShopProfile, day: Date, rng: Random): Planned[] {
  const { open, close } = openHours(profile, day)
  const [fewest, most] = profile.callsPerDay
  const sunday = day.getDay() === 0
  const count = Math.max(2, Math.round(rng.int(fewest, most) * (sunday ? 0.6 : 1)))
  const evening = rng.chance(0.7) ? 1 : 0
  const times = [
    ...spread(open.getTime() + 5 * MINUTE, close.getTime(), count - evening, rng),
    ...spread(close.getTime() + 10 * MINUTE, close.getTime() + 3 * HOUR, evening, rng),
  ]
  return times.map((endedAt) => ({
    kind: 'call',
    profile,
    outcome: rng.weighted(USUAL_MIX),
    endedAt,
  }))
}

/**
 * When the late-cancellation call happened: about half an hour ago if the
 * shop was open then, otherwise the last afternoon it was. The appointment
 * given up is about two hours after the call, inside the four-hour window.
 */
function planLateCancellation(profile: ShopProfile, now: Date): Planned {
  let endedAt = addMinutes(now, -35)
  let hours = openHours(profile, endedAt)
  if (endedAt.getTime() < hours.open.getTime() + 45 * MINUTE) {
    hours = openHours(profile, addDays(endedAt, -1))
    endedAt = hours.close
  }
  const lastSensibleCall = hours.close.getTime() - 3 * HOUR - 12 * MINUTE
  endedAt = new Date(Math.min(endedAt.getTime(), lastSensibleCall))

  const appointmentAt = addMinutes(endedAt, 110)
  appointmentAt.setMinutes(appointmentAt.getMinutes() < 30 ? 30 : 60, 0, 0)
  return { kind: 'late-cancellation', profile, endedAt, appointmentAt }
}

/** Bookings that did not come through Jarvis's calls this week. */
function addOtherBookings(
  profile: ShopProfile,
  schedule: Schedule,
  context: SeedContext,
): Appointment[] {
  const { now, rng, ids, cast } = context
  const added: Appointment[] = []
  const [fewest, most] = profile.otherBookingsPerDay

  for (let offset = 0; offset <= DAYS_AHEAD; offset++) {
    const day = addDays(startOfDay(now), offset)
    for (let n = rng.int(fewest, most); n > 0; n--) {
      const service = SERVICES[rng.weighted({ ...SERVICE_MIX, kidsCut: 6 })]
      const slot = schedule.book({ profile, day, minutes: service.minutes, rng })
      const customer = cast.customer(profile.id)
      const alreadyHappened = slot.startsAt.getTime() <= now.getTime()

      // A walk-in exists from the moment they sit down; anything in the
      // future was booked ahead, online or by phone before this week.
      const source = alreadyHappened
        ? rng.pick(['walk_in', 'online'] as const)
        : profile.status === 'paused'
          ? 'online'
          : rng.weighted({ online: 70, jarvis: 30 })
      const bookedAt =
        source === 'walk_in'
          ? slot.startsAt
          : new Date(
              Math.min(slot.startsAt.getTime(), now.getTime()) - rng.int(3, 96) * HOUR,
            )

      added.push({
        id: ids.next('appt'),
        shop_id: profile.id,
        external_id: source === 'online' ? `bk_${rng.hex(10)}` : null,
        call_id: null,
        customer_name: customer.name,
        customer_phone: source === 'walk_in' && rng.chance(0.5) ? null : customer.phone,
        service: service.name,
        barber: slot.barber,
        starts_at: iso(slot.startsAt),
        duration_minutes: service.minutes,
        status: 'booked',
        source,
        notes: null,
        created_at: iso(bookedAt),
      })
    }
  }
  return added
}

/** Where an appointment stands now that we know what time it is. */
function statusNow(appointment: Appointment, now: Date, rng: Random): AppointmentStatus {
  if (appointment.status === 'cancelled') return 'cancelled'
  const start = new Date(appointment.starts_at).getTime()
  const end = start + appointment.duration_minutes * MINUTE
  const inTheChair = start <= now.getTime() && now.getTime() < end
  if (inTheChair) return 'confirmed'
  if (end <= now.getTime()) {
    if (appointment.source === 'walk_in') return 'completed'
    return rng.weighted({ completed: 90, no_show: 7, cancelled: 3 })
  }
  // Reminder texts go out the evening before, so tomorrow is mostly confirmed.
  const soon = start - now.getTime() < 20 * HOUR
  return rng.chance(soon ? 0.75 : 0.2) ? 'confirmed' : 'booked'
}

export function seedReceptionist(context: SeedContext): ReceptionistSeed {
  const { now, rng, writer } = context
  const today = startOfDay(now)

  const planned: Planned[] = []
  for (const profile of SHOP_PROFILES) {
    const stopped = pausedSince(profile, now)
    for (let daysAgo = DAYS_OF_HISTORY; daysAgo >= 1; daysAgo--) {
      const calls = planPastDay(profile, addDays(today, -daysAgo), rng)
      planned.push(...calls.filter((call) => !stopped || call.endedAt < stopped))
    }
    planned.push(...planToday(profile, now, rng))
  }
  const busiest = SHOP_PROFILES.find((profile) => profile.status === 'active')
  if (busiest) planned.push(planLateCancellation(busiest, now))

  // Written oldest first, so earlier callers get first pick of the slots.
  planned.sort((a, b) => a.endedAt.getTime() - b.endedAt.getTime())

  const schedule = createSchedule()
  const calls: Call[] = []
  const appointments: Appointment[] = []
  let lateCancellation: LateCancellation | null = null

  for (const plan of planned) {
    if (plan.kind === 'late-cancellation') {
      const written = writer.writeLateCancellation(plan.profile, plan.endedAt, plan.appointmentAt)
      calls.push(written.call)
      appointments.push(...written.appointments)
      lateCancellation = { call: written.call, appointment: written.appointments[0] }
    } else {
      const written = writer.write(plan, schedule)
      calls.push(written.call)
      appointments.push(...written.appointments)
    }
  }

  for (const profile of SHOP_PROFILES) {
    appointments.push(...addOtherBookings(profile, schedule, context))
  }
  for (const appointment of appointments) {
    appointment.status = statusNow(appointment, now, rng)
  }
  appointments.sort((a, b) => a.starts_at.localeCompare(b.starts_at))

  return {
    shops: SHOP_PROFILES.map((profile) => toShop(profile, now)),
    calls,
    appointments,
    lateCancellation,
  }
}
