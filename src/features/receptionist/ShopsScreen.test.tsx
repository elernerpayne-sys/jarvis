import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ShopSummary } from '@/lib/types'
import { makeShop } from '@/features/receptionist/testing/fixtures'
import { renderReceptionist } from '@/features/receptionist/testing/render'

const api = vi.hoisted(() => ({ mode: 'demo', listShops: vi.fn() }))

vi.mock('@/services', async () => {
  const errors = await vi.importActual<typeof import('@/services/errors')>('@/services/errors')
  return { ...errors, api }
})

const eastside = makeShop()
const downtown = makeShop({
  id: 'shop-2',
  name: 'Kings Cut Downtown',
  address: '208 Congress Ave, Austin',
  calls_today: 9,
  bookings_today: 5,
  missed_today: 1,
})
const northLoop = makeShop({
  id: 'shop-3',
  name: 'North Loop Barbers',
  address: '5305 Burnet Rd, Austin',
  calls_today: 5,
  bookings_today: 3,
  missed_today: 0,
})

function rowFor(name: string): HTMLElement {
  const row = screen.getByText(name).closest('li')
  if (!row) throw new Error(`No row for ${name}`)
  return row
}

describe('Receptionist: shops list', () => {
  beforeEach(() => {
    api.listShops.mockReset()
  })

  it('lists each shop with today’s numbers and sums the day up in one sentence', async () => {
    api.listShops.mockResolvedValue([eastside, downtown, northLoop])
    renderReceptionist('/receptionist')

    expect(await screen.findByText('26 calls today across 3 shops, 3 missed.')).toBeInTheDocument()

    const first = within(rowFor('Fade Factory Eastside'))
    expect(first.getByText('1412 E 6th St, Austin')).toBeInTheDocument()
    expect(first.getByText('12 calls')).toBeInTheDocument()
    expect(first.getByText('7 booked')).toBeInTheDocument()
    expect(first.getByText('2 missed')).toBeInTheDocument()
    expect(first.getByRole('link')).toHaveAttribute('href', '/receptionist/shop-1')

    // A shop with nothing missed does not mention it.
    const third = within(rowFor('North Loop Barbers'))
    expect(third.getByText('5 calls')).toBeInTheDocument()
    expect(third.queryByText(/missed/)).not.toBeInTheDocument()
  })

  it('leaves the missed clause out when every caller got through', async () => {
    api.listShops.mockResolvedValue([northLoop, makeShop({ id: 'shop-4', calls_today: 1, missed_today: 0 })])
    renderReceptionist('/receptionist')

    expect(await screen.findByText('6 calls today across 2 shops.')).toBeInTheDocument()
    expect(screen.getByText('1 call')).toBeInTheDocument()
  })

  it('says when a shop is paused', async () => {
    const paused: ShopSummary = { ...downtown, status: 'paused', calls_today: 0, bookings_today: 0, missed_today: 0 }
    api.listShops.mockResolvedValue([eastside, paused])
    renderReceptionist('/receptionist')

    await screen.findByText('Kings Cut Downtown')
    expect(within(rowFor('Kings Cut Downtown')).getByText('Paused')).toBeInTheDocument()
    expect(within(rowFor('Fade Factory Eastside')).queryByText('Paused')).not.toBeInTheDocument()
  })

  it('shows placeholder rows while the shops load', () => {
    api.listShops.mockReturnValue(new Promise(() => {}))
    renderReceptionist('/receptionist')

    expect(screen.getByRole('heading', { name: 'Receptionist' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Loading shops' })).toBeInTheDocument()
  })

  it('explains an empty list', async () => {
    api.listShops.mockResolvedValue([])
    renderReceptionist('/receptionist')

    expect(await screen.findByText('No shops yet.')).toBeInTheDocument()
    expect(screen.getByText('Shops appear here once Jarvis is answering their phones.')).toBeInTheDocument()
  })

  it('says what went wrong and loads the shops on a retry', async () => {
    const user = userEvent.setup()
    api.listShops.mockRejectedValueOnce(new Error('The connection dropped.'))
    api.listShops.mockResolvedValue([eastside])
    renderReceptionist('/receptionist')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Couldn’t load your shops.')
    expect(alert).toHaveTextContent('The connection dropped.')

    await user.click(within(alert).getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Fade Factory Eastside')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
