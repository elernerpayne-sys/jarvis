/**
 * Who is in which chair, and when. Used to find a free slot for a booking so
 * no barber is ever double-booked in the sample data.
 */
import type { Appointment } from '@/lib/types'

import type { Random } from './random'
import { openHours } from './seed/shops'
import type { ShopProfile } from './seed/shops'
import { MINUTE, addDays, startOfDay } from './time'

/** Appointments start on the quarter hour. */
const GRID_MINUTES = 15
/** How many days ahead to look before giving up on a free chair. */
const SEARCH_DAYS = 21

export interface SlotRequest {
  profile: ShopProfile
  /** The day the customer would like. Later days are tried if it is full. */
  day: Date
  minutes: number
  /** The earliest acceptable start (a phone booking needs some notice). */
  notBefore?: Date
  /** Only this barber will do. */
  barber?: string
  rng: Random
}

export interface Slot {
  startsAt: Date
  barber: string
}

export interface Schedule {
  /** Finds a free chair, reserves it and returns it. */
  book(request: SlotRequest): Slot
}

export function createSchedule(existing: readonly Appointment[] = []): Schedule {
  // Busy intervals per barber per day, as [start, end) in epoch milliseconds.
  const busy = new Map<string, Array<[number, number]>>()
  const keyFor = (shopId: string, barber: string, at: Date) =>
    `${shopId}|${barber}|${startOfDay(at).getTime()}`

  function reserve(shopId: string, barber: string, startsAt: Date, minutes: number): void {
    const key = keyFor(shopId, barber, startsAt)
    const start = startsAt.getTime()
    busy.set(key, [...(busy.get(key) ?? []), [start, start + minutes * MINUTE]])
  }

  function isFree(shopId: string, barber: string, startsAt: Date, minutes: number): boolean {
    const start = startsAt.getTime()
    const end = start + minutes * MINUTE
    return (busy.get(keyFor(shopId, barber, startsAt)) ?? []).every(
      ([from, to]) => end <= from || start >= to,
    )
  }

  for (const appointment of existing) {
    if (appointment.barber && appointment.status !== 'cancelled') {
      reserve(
        appointment.shop_id,
        appointment.barber,
        new Date(appointment.starts_at),
        appointment.duration_minutes,
      )
    }
  }

  /** Every start time on the day, in a random order that favours :00 and :30. */
  function startTimes(request: SlotRequest, day: Date): Date[] {
    const { open, close } = openHours(request.profile, day)
    const lastStart = close.getTime() - request.minutes * MINUTE
    const earliest = request.notBefore?.getTime() ?? 0
    const times: Array<{ at: Date; order: number }> = []
    for (let t = open.getTime(); t <= lastStart; t += GRID_MINUTES * MINUTE) {
      if (t < earliest) continue
      const at = new Date(t)
      const onTheHalfHour = at.getMinutes() % 30 === 0
      times.push({ at, order: request.rng.next() * (onTheHalfHour ? 1 : 3) })
    }
    return times.sort((a, b) => a.order - b.order).map((time) => time.at)
  }

  function book(request: SlotRequest): Slot {
    const { profile, minutes, rng } = request
    for (let offset = 0; offset < SEARCH_DAYS; offset++) {
      const day = addDays(startOfDay(request.day), offset)
      const barbers = request.barber ? [request.barber] : rng.shuffle(profile.barbers)
      for (const startsAt of startTimes(request, day)) {
        const barber = barbers.find((name) => isFree(profile.id, name, startsAt, minutes))
        if (barber) {
          reserve(profile.id, barber, startsAt, minutes)
          return { startsAt, barber }
        }
      }
    }
    throw new Error(`No free chair at ${profile.name} in the next ${SEARCH_DAYS} days.`)
  }

  return { book }
}
