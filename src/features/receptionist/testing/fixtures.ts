/** Sample rows for the Receptionist tests. Plain data: nothing here touches the service. */
import type { Appointment, Call, CallSummary, ShopSummary } from '@/lib/types'

/** The moment every test runs at: Thursday 19 November 2026, 10:00 local time. */
export const NOW = new Date(2026, 10, 19, 10, 0, 0)

/** A timestamp `days` days from NOW's date at the given local time. */
export function at(days: number, hours: number, minutes = 0): string {
  return new Date(2026, 10, 19 + days, hours, minutes, 0).toISOString()
}

export function makeShop(overrides: Partial<ShopSummary> = {}): ShopSummary {
  return {
    id: 'shop-1',
    name: 'Fade Factory Eastside',
    phone: '+15125550142',
    address: '1412 E 6th St, Austin',
    timezone: 'America/Chicago',
    status: 'active',
    created_at: at(-90, 9),
    calls_today: 12,
    bookings_today: 7,
    missed_today: 2,
    next_appointment_at: at(0, 11),
    ...overrides,
  }
}

export function makeAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'appt-1',
    shop_id: 'shop-1',
    external_id: null,
    call_id: null,
    customer_name: 'Devon Hill',
    customer_phone: '+15125550111',
    service: 'Skin fade',
    barber: 'Marcus',
    starts_at: at(0, 14, 30),
    duration_minutes: 45,
    status: 'booked',
    source: 'jarvis',
    notes: null,
    created_at: at(0, 9),
    ...overrides,
  }
}

export function makeCallSummary(overrides: Partial<CallSummary> = {}): CallSummary {
  return {
    id: 'call-1',
    shop_id: 'shop-1',
    external_id: null,
    caller_name: 'Devon Hill',
    caller_phone: '+15125550111',
    started_at: at(0, 9, 40),
    duration_seconds: 134,
    outcome: 'booked',
    summary: 'Booked a skin fade with Marcus for 2:30 this afternoon.',
    created_at: at(0, 9, 40),
    ...overrides,
  }
}

export function makeCall(overrides: Partial<Call> = {}): Call {
  return {
    ...makeCallSummary(),
    transcript: [
      { role: 'agent', text: 'Thanks for calling Fade Factory. How can I help?', t: 0 },
      { role: 'caller', text: 'Do you have anything this afternoon?', t: 7 },
      { role: 'agent', text: 'Marcus is free at 2:30. Shall I book it?', t: 12 },
    ],
    ...overrides,
  }
}
