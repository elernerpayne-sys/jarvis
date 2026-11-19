/**
 * The three sample barbershops and what they sell. Edit names, hours, barbers
 * and prices here; calls, appointments and the handbook's price list and
 * opening hours are all built from this file.
 */
import type { ShopStatus } from '@/lib/types'

import { WEEKDAYS, atHour, hourLabel } from '../time'

export interface Service {
  /** As it appears on an appointment: "Skin fade". */
  name: string
  /** As it is said on a call: "a skin fade". */
  spoken: string
  price: number
  minutes: number
}

export const SERVICES = {
  skinFade: { name: 'Skin fade', spoken: 'a skin fade', price: 35, minutes: 45 },
  classicCut: { name: 'Classic cut', spoken: 'a classic cut', price: 30, minutes: 30 },
  cutAndBeard: { name: 'Cut and beard trim', spoken: 'a cut and beard trim', price: 42, minutes: 45 },
  kidsCut: { name: 'Kids cut', spoken: 'a kids cut', price: 22, minutes: 30 },
  hotTowelShave: { name: 'Hot towel shave', spoken: 'a hot towel shave', price: 28, minutes: 30 },
  beardTrim: { name: 'Beard trim', spoken: 'a beard trim', price: 15, minutes: 15 },
  lineUp: { name: 'Line-up', spoken: 'a line-up', price: 12, minutes: 15 },
} as const satisfies Record<string, Service>

export type ServiceKey = keyof typeof SERVICES

/** How often each service is booked, relative to the others. */
export const SERVICE_MIX: Record<ServiceKey, number> = {
  skinFade: 30,
  classicCut: 24,
  cutAndBeard: 14,
  kidsCut: 0, // only booked through the kids-cut conversation
  hotTowelShave: 8,
  beardTrim: 10,
  lineUp: 10,
}

/** Opening and closing hour (24-hour clock; 18.5 is 6:30 PM). */
export type Hours = readonly [open: number, close: number]

export interface ShopProfile {
  id: string
  name: string
  /** The line Jarvis answers, E.164. */
  phone: string
  address: string
  timezone: string
  status: ShopStatus
  /** How long Jarvis has been answering here. */
  joinedDaysAgo: number
  barbers: readonly string[]
  /** Hours for each weekday, Sunday first. */
  hours: readonly [Hours, Hours, Hours, Hours, Hours, Hours, Hours]
  /** What Jarvis tells a caller who asks where to park. */
  parking: string
  /** Calls so far today: fewest and most. Leave out for a paused shop. */
  callsToday: readonly [number, number] | null
  /** Calls on a full weekday or Saturday: fewest and most. */
  callsPerDay: readonly [number, number]
  /** Online and walk-in appointments added per day, on top of phone bookings. */
  otherBookingsPerDay: readonly [number, number]
  /** Jarvis stopped answering this many days ago; the call log ends there. */
  pausedDaysAgo: number | null
}

export const SHOP_PROFILES: readonly ShopProfile[] = [
  {
    id: 'shop-fade-house',
    name: 'Fade House',
    phone: '+15125550142',
    address: '1804 E 6th St, Austin, TX 78702',
    timezone: 'America/Chicago',
    status: 'active',
    joinedDaysAgo: 248,
    barbers: ['Marcus', 'Dre', 'Tino', 'Sam'],
    hours: [[10, 16], [9, 19], [9, 19], [9, 19], [9, 19], [9, 19], [8, 18]],
    parking: 'There’s a small lot behind the shop and street parking on 6th.',
    callsToday: [11, 14],
    callsPerDay: [9, 13],
    otherBookingsPerDay: [2, 4],
    pausedDaysAgo: null,
  },
  {
    id: 'shop-burnet-road',
    name: 'Burnet Road Barbers',
    phone: '+15125550167',
    address: '5412 Burnet Rd, Austin, TX 78756',
    timezone: 'America/Chicago',
    status: 'active',
    joinedDaysAgo: 171,
    barbers: ['Luis', 'Hank', 'Joelle'],
    hours: [[11, 16], [10, 18], [10, 18], [10, 18], [10, 19], [10, 19], [9, 17]],
    parking: 'Park in the lot we share with the taqueria next door. It’s free.',
    callsToday: [6, 8],
    callsPerDay: [5, 8],
    otherBookingsPerDay: [1, 3],
    pausedDaysAgo: null,
  },
  {
    id: 'shop-south-lamar',
    name: 'South Lamar Shave Parlor',
    phone: '+15125550118',
    address: '2110 S Lamar Blvd, Austin, TX 78704',
    timezone: 'America/Chicago',
    // Paused two days ago while the new front desk hire learns the phones
    // (see the decisions log). The call history before that is still here.
    status: 'paused',
    joinedDaysAgo: 96,
    barbers: ['Ray', 'Nico'],
    hours: [[10, 16], [9, 18], [9, 18], [9, 18], [9, 18], [9, 18], [9, 17]],
    parking: 'There’s parking in front of the shop and more around the back.',
    callsToday: null,
    callsPerDay: [4, 6],
    otherBookingsPerDay: [3, 5],
    pausedDaysAgo: 2,
  },
]

/** When the shop opens and closes on the given day. */
export function openHours(profile: ShopProfile, day: Date): { open: Date; close: Date } {
  const [open, close] = profile.hours[day.getDay()]
  return { open: atHour(day, open), close: atHour(day, close) }
}

/** The street part of the address: "1804 E 6th St". */
export function streetAddress(profile: ShopProfile): string {
  return profile.address.split(',')[0]
}

/**
 * Opening hours in words, Monday first, with matching days folded together:
 * "Monday to Friday: 9 AM to 7 PM".
 */
export function describeHours(profile: ShopProfile): string[] {
  const order = [1, 2, 3, 4, 5, 6, 0]
  const lines: string[] = []
  let start = 0
  while (start < order.length) {
    const [open, close] = profile.hours[order[start]]
    let end = start
    while (end + 1 < order.length) {
      const [nextOpen, nextClose] = profile.hours[order[end + 1]]
      if (nextOpen !== open || nextClose !== close) break
      end += 1
    }
    const first = WEEKDAYS[order[start]]
    const last = WEEKDAYS[order[end]]
    const days = start === end ? first : `${first} to ${last}`
    lines.push(`${days}: ${hourLabel(open)} to ${hourLabel(close)}`)
    start = end + 1
  }
  return lines
}
