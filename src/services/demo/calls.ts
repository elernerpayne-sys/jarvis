/**
 * Turns "a booked call at Fade House that ended at 2:14 PM" into rows: the
 * call with its timed transcript, and the appointment it produced. The seed
 * uses this for the past week and the simulator uses it for calls that come
 * in while the app is open, so both read the same.
 */
import type { Appointment, Call, CallOutcome, TranscriptTurn } from '@/lib/types'

import type { Ids } from './ids'
import type { Random } from './random'
import type { Schedule } from './schedule'
import {
  BOOKING_CONVERSATIONS,
  CONVERSATIONS,
  lateCancellationScript,
  missedCallSummary,
} from './seed/conversations'
import type { BookingScene, Line, Scene, Script } from './seed/conversations'
import { LATE_CANCEL_CUSTOMER } from './seed/people'
import type { Cast, Customer } from './seed/people'
import { SERVICES, SERVICE_MIX, openHours, streetAddress } from './seed/shops'
import type { ShopProfile } from './seed/shops'
import { addDays, addMinutes, addSeconds, iso } from './time'

/** Jarvis only books slots that start at least this long after the call. */
const NOTICE_MINUTES = 45
/** Roughly how fast people talk on the phone. */
const CHARACTERS_PER_SECOND = 15
/** How many days out callers ask for, and how often. */
const DAYS_AHEAD = { '0': 35, '1': 30, '2': 18, '3': 10, '4': 7 } as const

export interface CallRequest {
  profile: ShopProfile
  outcome: CallOutcome
  /**
   * When the call ended. The start is worked out backwards from here, so a
   * call written "now" is never in the future.
   */
  endedAt: Date
}

export interface WrittenCall {
  call: Call
  /** The appointment this call booked, or the one it cancelled. */
  appointments: Appointment[]
}

export interface CallWriter {
  write(request: CallRequest, schedule: Schedule): WrittenCall
  /** The regular who cancels late and asks not to be charged (see Home). */
  writeLateCancellation(profile: ShopProfile, endedAt: Date, appointmentAt: Date): WrittenCall
}

/** Gives every line a start time, and the call a length. */
function timeTranscript(
  lines: readonly Line[],
  rng: Random,
): { transcript: TranscriptTurn[]; seconds: number } {
  const transcript: TranscriptTurn[] = []
  let clock = 0
  for (const [role, text, pauseBefore] of lines) {
    clock += pauseBefore ?? rng.int(4, 12) / 10
    const previous = transcript.at(-1)
    const t = Math.max(Math.round(clock), previous ? previous.t + 1 : 1)
    transcript.push({ role, text, t })
    clock = t + text.length / CHARACTERS_PER_SECOND
  }
  return { transcript, seconds: Math.ceil(clock) }
}

export function createCallWriter(deps: { rng: Random; ids: Ids; cast: Cast }): CallWriter {
  const { rng, ids, cast } = deps

  function stranger(): Customer {
    return { name: '', first: '', last: '', phone: cast.strangerPhone() }
  }

  function sceneFor(profile: ShopProfile, caller: Customer, at: Date): Scene {
    const { open, close } = openHours(profile, at)
    return {
      rng,
      shopName: profile.name,
      street: streetAddress(profile),
      parking: profile.parking,
      barbers: profile.barbers,
      caller,
      at,
      open,
      close,
      opensTomorrow: openHours(profile, addDays(at, 1)).open,
    }
  }

  function callRow(
    request: CallRequest,
    caller: { name: string | null; phone: string },
    details: { summary: string; transcript: TranscriptTurn[]; seconds: number },
  ): Call {
    return {
      id: ids.next('call'),
      shop_id: request.profile.id,
      external_id: `CA${rng.hex(32)}`,
      caller_name: caller.name,
      caller_phone: caller.phone,
      started_at: iso(addSeconds(request.endedAt, -details.seconds)),
      duration_seconds: details.seconds,
      outcome: request.outcome,
      summary: details.summary,
      transcript: details.transcript,
      created_at: iso(request.endedAt),
    }
  }

  /** A call where words were exchanged: time the script and build the row. */
  function spokenCall(
    request: CallRequest,
    caller: { name: string | null; phone: string },
    script: Script,
  ): Call {
    const timed = timeTranscript(script.lines, rng)
    return callRow(request, script.caller ?? caller, {
      summary: script.summary,
      transcript: timed.transcript,
      seconds: timed.seconds + (script.holdSeconds ?? 0),
    })
  }

  /** The appointment a caller already had and gave up on this call. */
  function cancelledAppointment(
    request: CallRequest,
    caller: Customer,
    cancels: NonNullable<Script['cancels']>,
  ): Appointment {
    return {
      id: ids.next('appt'),
      shop_id: request.profile.id,
      external_id: null,
      call_id: null,
      customer_name: caller.name,
      customer_phone: caller.phone,
      service: cancels.service.name,
      barber: cancels.barber,
      starts_at: iso(cancels.startsAt),
      duration_minutes: cancels.service.minutes,
      status: 'cancelled',
      source: 'jarvis',
      notes: 'Cancelled by phone.',
      created_at: iso(addDays(request.endedAt, -3)),
    }
  }

  /** The first of the nearby times that passes `fits`, else half an hour later. */
  function nearby(startsAt: Date, offsets: readonly number[], fits: (at: Date) => boolean): Date {
    const options = offsets.map((minutes) => addMinutes(startsAt, minutes))
    return options.find(fits) ?? addMinutes(startsAt, 30)
  }

  function writeBooking(request: CallRequest, schedule: Schedule): WrittenCall {
    const { profile, endedAt } = request
    const conversation = rng.pick(BOOKING_CONVERSATIONS)
    const caller = conversation.forChild ? cast.parent() : cast.customer(profile.id)
    const service =
      SERVICES[conversation.services ? rng.pick(conversation.services) : rng.weighted(SERVICE_MIX)]
    const daysAhead = conversation.wantsToday ? 0 : Number(rng.weighted(DAYS_AHEAD))

    const slot = schedule.book({
      profile,
      day: addDays(endedAt, daysAhead),
      minutes: service.minutes,
      notBefore: addMinutes(endedAt, NOTICE_MINUTES),
      barber: conversation.asksForBarber ? rng.pick(profile.barbers) : undefined,
      rng,
    })

    const { open, close } = openHours(profile, slot.startsAt)
    const bookable = (at: Date) =>
      at >= open && addMinutes(at, 30) <= close && at >= addMinutes(endedAt, 30)
    const scene: BookingScene = {
      ...sceneFor(profile, caller, endedAt),
      service,
      barber: slot.barber,
      otherBarber: rng.pick(profile.barbers.filter((name) => name !== slot.barber)),
      startsAt: slot.startsAt,
      alternative: nearby(slot.startsAt, [60, 30, -60, -30], bookable),
      taken: nearby(slot.startsAt, [-60, -30, 30, 45], bookable),
    }

    const script = conversation.write(scene)
    const call = spokenCall(request, caller, script)
    const appointment: Appointment = {
      id: ids.next('appt'),
      shop_id: profile.id,
      external_id: null,
      call_id: call.id,
      customer_name: script.appointmentFor ?? caller.name,
      customer_phone: caller.phone,
      service: service.name,
      barber: slot.barber,
      starts_at: iso(slot.startsAt),
      duration_minutes: service.minutes,
      status: 'booked',
      source: 'jarvis',
      notes: script.appointmentNotes ?? null,
      created_at: iso(endedAt),
    }
    return { call, appointments: [appointment] }
  }

  function writeMissed(request: CallRequest): WrittenCall {
    // Caller ID sometimes matches a customer; mostly it is just a number.
    const known = rng.chance(0.35) ? cast.customer(request.profile.id) : null
    const seconds = rng.int(0, 8)
    const call = callRow(
      request,
      { name: known?.name ?? null, phone: known?.phone ?? cast.strangerPhone() },
      { summary: missedCallSummary(seconds), transcript: [], seconds },
    )
    return { call, appointments: [] }
  }

  return {
    write(request, schedule) {
      if (request.outcome === 'booked') return writeBooking(request, schedule)
      if (request.outcome === 'missed') return writeMissed(request)

      const conversation = rng.pick(CONVERSATIONS[request.outcome])
      // People who don't give a name are only known when caller ID matches.
      const recognised = conversation.named || rng.chance(0.35)
      const caller = recognised ? cast.customer(request.profile.id) : stranger()
      const script = conversation.write(sceneFor(request.profile, caller, request.endedAt))
      const call = spokenCall(
        request,
        { name: recognised ? caller.name : null, phone: caller.phone },
        script,
      )
      const appointments = script.cancels
        ? [cancelledAppointment(request, caller, script.cancels)]
        : []
      return { call, appointments }
    },

    writeLateCancellation(profile, endedAt, appointmentAt) {
      const request: CallRequest = { profile, outcome: 'message', endedAt }
      const caller = LATE_CANCEL_CUSTOMER
      const script = lateCancellationScript(
        sceneFor(profile, caller, endedAt),
        profile.barbers[0],
        appointmentAt,
      )
      const call = spokenCall(request, caller, script)
      const appointments = script.cancels
        ? [cancelledAppointment(request, caller, script.cancels)]
        : []
      return { call, appointments }
    },
  }
}
