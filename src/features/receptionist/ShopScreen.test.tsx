import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { formatDay, formatTime } from '@/lib/format'
import type { Appointment, CallFilter, CallSummary, ShopSummary } from '@/lib/types'
import { ServiceError } from '@/services/errors'
import { NOW, at, makeAppointment, makeCallSummary, makeShop } from '@/features/receptionist/testing/fixtures'
import { renderReceptionist } from '@/features/receptionist/testing/render'

const api = vi.hoisted(() => ({
  mode: 'demo',
  getShop: vi.fn(),
  listUpcomingAppointments: vi.fn(),
  listCalls: vi.fn(),
  getCall: vi.fn(),
}))

vi.mock('@/services', async () => {
  const errors = await vi.importActual<typeof import('@/services/errors')>('@/services/errors')
  return { ...errors, api }
})

const booked = makeCallSummary()
const missed = makeCallSummary({
  id: 'call-2',
  caller_name: null,
  caller_phone: '+15125550177',
  started_at: at(0, 9, 10),
  duration_seconds: 0,
  outcome: 'missed',
  summary: null,
})
const failed = makeCallSummary({
  id: 'call-3',
  caller_name: 'Ana Ruiz',
  caller_phone: '+15125550123',
  started_at: at(-1, 17, 5),
  duration_seconds: 21,
  outcome: 'failed',
  summary: 'The line dropped while Ana was asking about Saturday.',
})

/** Answers like the real service: the problems filter keeps missed and failed calls. */
function serve(data: { shop?: ShopSummary; appointments?: Appointment[]; calls?: CallSummary[] } = {}) {
  const calls = data.calls ?? []
  api.getShop.mockResolvedValue(data.shop ?? makeShop())
  api.listUpcomingAppointments.mockResolvedValue(data.appointments ?? [])
  api.listCalls.mockImplementation(async (_shopId: string, options?: { filter?: CallFilter }) =>
    options?.filter === 'problems' ? calls.filter((call) => call.outcome === 'missed' || call.outcome === 'failed') : calls,
  )
}

/** The block of the page under a section heading, once the shop has loaded. */
async function section(name: string): Promise<HTMLElement> {
  const block = (await screen.findByRole('heading', { level: 2, name })).closest('section')
  if (!block) throw new Error(`No section called ${name}`)
  return block
}

function location(): HTMLElement {
  return screen.getByTestId('location')
}

describe('Receptionist: one shop', () => {
  beforeEach(() => {
    // Only the clock is pinned; timers still run, so queries and clicks behave normally.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    for (const mock of Object.values(api)) {
      if (typeof mock !== 'string') mock.mockReset()
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the shop, how to reach it, and today’s numbers', async () => {
    serve()
    renderReceptionist('/receptionist/shop-1')

    expect(await screen.findByRole('heading', { level: 1, name: 'Fade Factory Eastside' })).toBeInTheDocument()
    expect(screen.getByText('(512) 555-0142')).toBeInTheDocument()
    expect(screen.getByText('1412 E 6th St, Austin')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Receptionist' })).toHaveAttribute('href', '/receptionist')

    const today = within(await section('Today'))
    expect(today.getByText('Calls').nextElementSibling).toHaveTextContent('12')
    expect(today.getByText('Booked').nextElementSibling).toHaveTextContent('7')
    expect(today.getByText('Missed').nextElementSibling).toHaveTextContent('2')
  })

  it('says so when the shop does not exist, with a way back instead of a retry', async () => {
    serve()
    api.getShop.mockRejectedValue(new ServiceError('not_found', 'That shop was not found.'))
    renderReceptionist('/receptionist/gone')

    expect(await screen.findByRole('heading', { name: 'This shop doesn’t exist' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See all shops' })).toHaveAttribute('href', '/receptionist')
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })

  it('offers a retry when the shop fails to load', async () => {
    const user = userEvent.setup()
    serve()
    let online = false
    api.getShop.mockImplementation(async () => {
      if (!online) throw new Error('The connection dropped.')
      return makeShop()
    })
    renderReceptionist('/receptionist/shop-1')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Couldn’t load this shop.')
    expect(alert).toHaveTextContent('The connection dropped.')

    online = true
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Fade Factory Eastside' })).toBeInTheDocument()
  })

  describe('upcoming appointments', () => {
    it('groups them by day, with the time, who, what and with whom', async () => {
      const devon = makeAppointment()
      const sam = makeAppointment({
        id: 'appt-2',
        customer_name: 'Sam Ortiz',
        service: 'Beard trim',
        barber: null,
        starts_at: at(0, 16),
        status: 'confirmed',
      })
      const lee = makeAppointment({
        id: 'appt-3',
        customer_name: 'Lee Park',
        service: 'Kids cut',
        barber: 'Tasha',
        starts_at: at(1, 10),
      })
      const later = makeAppointment({ id: 'appt-4', customer_name: 'Omar Reyes', starts_at: at(3, 12) })
      serve({ appointments: [devon, sam, lee, later] })
      renderReceptionist('/receptionist/shop-1')

      const upcoming = within(await section('Upcoming appointments'))
      const dayOf = async (name: string) => {
        const heading = await upcoming.findByRole('heading', { level: 3, name })
        return within(heading.parentElement as HTMLElement)
      }

      const today = await dayOf('Today')
      expect(today.getAllByRole('listitem')).toHaveLength(2)
      expect(today.getByText('Devon Hill')).toBeInTheDocument()
      expect(today.getByText('Skin fade with Marcus')).toBeInTheDocument()
      expect(today.getByText(formatTime(devon.starts_at))).toBeInTheDocument()
      // No barber: just the service.
      expect(today.getByText('Beard trim')).toBeInTheDocument()

      const tomorrow = await dayOf('Tomorrow')
      expect(tomorrow.getAllByRole('listitem')).toHaveLength(1)
      expect(tomorrow.getByText('Lee Park')).toBeInTheDocument()
      expect(tomorrow.getByText('Kids cut with Tasha')).toBeInTheDocument()

      const afterThat = await dayOf(formatDay(later.starts_at, NOW))
      expect(afterThat.getByText('Omar Reyes')).toBeInTheDocument()

      // A plain booking carries no status; anything else says what it is.
      expect(upcoming.getByText('Confirmed')).toBeInTheDocument()
      expect(upcoming.queryByText('Booked')).not.toBeInTheDocument()
    })

    it('shows the first six, and the rest on "Show all"', async () => {
      const user = userEvent.setup()
      const appointments = Array.from({ length: 8 }, (_, index) =>
        makeAppointment({ id: `appt-${index}`, customer_name: `Customer ${index + 1}`, starts_at: at(0, 11 + index) }),
      )
      serve({ appointments })
      renderReceptionist('/receptionist/shop-1')

      const upcoming = within(await section('Upcoming appointments'))
      expect(await upcoming.findByText('Customer 6')).toBeInTheDocument()
      expect(upcoming.queryByText('Customer 7')).not.toBeInTheDocument()

      await user.click(upcoming.getByRole('button', { name: 'Show all 8' }))
      expect(upcoming.getByText('Customer 7')).toBeInTheDocument()
      expect(upcoming.getByText('Customer 8')).toBeInTheDocument()

      await user.click(upcoming.getByRole('button', { name: 'Show fewer' }))
      expect(upcoming.queryByText('Customer 7')).not.toBeInTheDocument()
    })

    it('has no "Show all" when everything already fits', async () => {
      serve({ appointments: [makeAppointment()] })
      renderReceptionist('/receptionist/shop-1')

      const upcoming = within(await section('Upcoming appointments'))
      expect(await upcoming.findByText('Devon Hill')).toBeInTheDocument()
      expect(upcoming.queryByRole('button')).not.toBeInTheDocument()
    })

    it('says when nothing is booked', async () => {
      serve()
      renderReceptionist('/receptionist/shop-1')

      expect(await screen.findByText('No upcoming appointments.')).toBeInTheDocument()
    })

    it('offers a retry when they fail to load, without losing the rest of the screen', async () => {
      serve({ calls: [booked] })
      api.listUpcomingAppointments.mockRejectedValue(new Error('The connection dropped.'))
      renderReceptionist('/receptionist/shop-1')

      const upcoming = within(await section('Upcoming appointments'))
      expect(await upcoming.findByRole('alert')).toHaveTextContent('Couldn’t load appointments.')
      expect(upcoming.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
      expect(await within(await section('Calls')).findByText('Devon Hill')).toBeInTheDocument()
    })
  })

  describe('calls', () => {
    it('lists each call with the caller, the summary and how it ended', async () => {
      serve({ calls: [booked, missed, failed] })
      renderReceptionist('/receptionist/shop-1')

      const calls = within(await section('Calls'))
      const rowFor = async (title: string) => {
        const row = (await calls.findByText(title)).closest('li')
        return within(row as HTMLElement)
      }

      const first = await rowFor('Devon Hill')
      expect(first.getByText('Booked a skin fade with Marcus for 2:30 this afternoon.')).toBeInTheDocument()
      expect(first.getByText('Booked')).toBeInTheDocument()
      expect(first.getByText('20m ago')).toBeInTheDocument()

      // No name on record: the number stands in for it.
      const second = await rowFor('(512) 555-0177')
      expect(second.getByText('Missed')).toBeInTheDocument()

      const third = await rowFor('Ana Ruiz')
      expect(third.getByText('Failed')).toBeInTheDocument()
      expect(third.getByText('Yesterday')).toBeInTheDocument()
    })

    it('switches to missed or failed calls and remembers the choice in the URL', async () => {
      const user = userEvent.setup()
      serve({ calls: [booked, missed, failed] })
      renderReceptionist('/receptionist/shop-1')

      const calls = within(await section('Calls'))
      expect(await calls.findByText('Devon Hill')).toBeInTheDocument()
      expect(calls.getByRole('radio', { name: 'All' })).toBeChecked()
      expect(api.listCalls).toHaveBeenLastCalledWith('shop-1', { filter: 'all' })

      await user.click(calls.getByRole('radio', { name: 'Missed or failed' }))

      expect(await calls.findByText('Ana Ruiz')).toBeInTheDocument()
      expect(calls.queryByText('Devon Hill')).not.toBeInTheDocument()
      expect(calls.getByRole('radio', { name: 'Missed or failed' })).toBeChecked()
      expect(api.listCalls).toHaveBeenLastCalledWith('shop-1', { filter: 'problems' })
      expect(location()).toHaveTextContent('/receptionist/shop-1?filter=problems')

      await user.click(calls.getByRole('radio', { name: 'All' }))

      expect(await calls.findByText('Devon Hill')).toBeInTheDocument()
      expect(location()).toHaveTextContent(/^\/receptionist\/shop-1$/)
    })

    it('does not add a history entry per filter change: Back still leaves the shop', async () => {
      const user = userEvent.setup()
      serve({ calls: [booked, missed] })
      renderReceptionist('/receptionist', '/receptionist/shop-1')

      const calls = within(await section('Calls'))
      await user.click(await calls.findByRole('radio', { name: 'Missed or failed' }))
      await waitFor(() => expect(location()).toHaveTextContent('?filter=problems'))

      await user.click(screen.getByRole('button', { name: 'Browser back' }))

      await waitFor(() => expect(location()).toHaveTextContent(/^\/receptionist$/))
    })

    it('opens on the filter the URL asks for', async () => {
      serve({ calls: [booked, missed] })
      renderReceptionist('/receptionist/shop-1?filter=problems')

      const calls = within(await section('Calls'))
      expect(await calls.findByText('(512) 555-0177')).toBeInTheDocument()
      expect(calls.getByRole('radio', { name: 'Missed or failed' })).toBeChecked()
      expect(calls.queryByText('Devon Hill')).not.toBeInTheDocument()
    })

    it('says when there are no calls at all', async () => {
      serve()
      renderReceptionist('/receptionist/shop-1')

      expect(await screen.findByText('No calls yet.')).toBeInTheDocument()
    })

    it('says when no call was missed or failed', async () => {
      serve({ calls: [booked] })
      renderReceptionist('/receptionist/shop-1?filter=problems')

      expect(await screen.findByText('No missed or failed calls.')).toBeInTheDocument()
      expect(screen.getByText('Every caller got through.')).toBeInTheDocument()
    })

    it('shows the newest twenty until asked for all of them', async () => {
      const user = userEvent.setup()
      const many = Array.from({ length: 23 }, (_, index) =>
        makeCallSummary({ id: `call-${index}`, caller_name: `Caller ${index + 1}`, started_at: at(0, 9, 59 - index) }),
      )
      serve({ calls: many })
      renderReceptionist('/receptionist/shop-1')

      const calls = within(await section('Calls'))
      expect(await calls.findByText('Caller 20')).toBeInTheDocument()
      expect(calls.queryByText('Caller 21')).not.toBeInTheDocument()

      await user.click(calls.getByRole('button', { name: 'Show all 23' }))
      expect(calls.getByText('Caller 23')).toBeInTheDocument()
    })
  })
})
