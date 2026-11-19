import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { formatDayTime } from '@/lib/format'
import type { Call, CallFilter, CallSummary } from '@/lib/types'
import { ServiceError } from '@/services/errors'
import { NOW, at, makeCall, makeShop } from '@/features/receptionist/testing/fixtures'
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

const booked = makeCall()
const missed = makeCall({
  id: 'call-2',
  caller_name: null,
  caller_phone: '+15125550177',
  started_at: at(0, 9, 10),
  duration_seconds: 0,
  outcome: 'missed',
  summary: null,
  transcript: [],
})
const byId: Record<string, Call> = { [booked.id]: booked, [missed.id]: missed }

/** The call list as the service returns it: no transcripts. */
function summaries(calls: Call[]): CallSummary[] {
  return calls.map(({ transcript: _transcript, ...summary }) => summary)
}

function location(): HTMLElement {
  return screen.getByTestId('location')
}

/** The row in the call list that opens a call. */
function callRow(name: RegExp) {
  return screen.findByRole('button', { name })
}

describe('Receptionist: one call', () => {
  beforeEach(() => {
    // Only the clock is pinned; timers still run, so queries and clicks behave normally.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    for (const mock of Object.values(api)) {
      if (typeof mock !== 'string') mock.mockReset()
    }
    api.getShop.mockResolvedValue(makeShop())
    api.listUpcomingAppointments.mockResolvedValue([])
    api.listCalls.mockImplementation(async (_shopId: string, options?: { filter?: CallFilter }) =>
      summaries(options?.filter === 'problems' ? [missed] : [booked, missed]),
    )
    api.getCall.mockImplementation(async (id: string) => {
      const call = byId[id]
      if (!call) throw new ServiceError('not_found', 'That call was not found.')
      return call
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens from the list with the outcome, the summary and the whole conversation', async () => {
    const user = userEvent.setup()
    renderReceptionist('/receptionist/shop-1')

    await user.click(await callRow(/Devon Hill/))

    const dialog = within(await screen.findByRole('dialog', { name: 'Devon Hill' }))
    expect(location()).toHaveTextContent('/receptionist/shop-1?call=call-1')

    expect(dialog.getByText('(512) 555-0111')).toBeInTheDocument()
    expect(dialog.getByText('Booked')).toBeInTheDocument()
    expect(dialog.getByText(formatDayTime(booked.started_at, NOW))).toBeInTheDocument()
    expect(dialog.getByText('Lasted 2m 14s')).toBeInTheDocument()
    expect(dialog.getByRole('link', { name: 'Call back' })).toHaveAttribute('href', 'tel:+15125550111')
    expect(dialog.getByText('Booked a skin fade with Marcus for 2:30 this afternoon.')).toBeInTheDocument()

    // Every turn, in order, each marked with who is speaking and when.
    const turns = await dialog.findAllByRole('listitem')
    expect(turns).toHaveLength(3)
    expect(turns[0]).toHaveTextContent('0:00')
    expect(turns[0]).toHaveTextContent('Jarvis: Thanks for calling Fade Factory. How can I help?')
    expect(turns[1]).toHaveTextContent('0:07')
    expect(turns[1]).toHaveTextContent('Caller: Do you have anything this afternoon?')
    expect(turns[2]).toHaveTextContent('0:12')
    expect(turns[2]).toHaveTextContent('Jarvis: Marcus is free at 2:30. Shall I book it?')
  })

  it('sets Jarvis’s lines apart from the caller’s', async () => {
    renderReceptionist('/receptionist/shop-1?call=call-1')

    const dialog = within(await screen.findByRole('dialog', { name: 'Devon Hill' }))
    const jarvis = await dialog.findByText('Thanks for calling Fade Factory. How can I help?')
    const caller = dialog.getByText('Do you have anything this afternoon?')

    // Jarvis speaks in the voice typeface; the caller does not.
    expect(jarvis).toHaveClass('font-voice')
    expect(caller).not.toHaveClass('font-voice')
  })

  it('shows what the list already knows while the conversation loads', async () => {
    const user = userEvent.setup()
    api.getCall.mockReturnValue(new Promise(() => {}))
    renderReceptionist('/receptionist/shop-1')

    await user.click(await callRow(/Devon Hill/))

    const dialog = within(await screen.findByRole('dialog', { name: 'Devon Hill' }))
    expect(dialog.getByText('Booked a skin fade with Marcus for 2:30 this afternoon.')).toBeInTheDocument()
    expect(dialog.getByRole('status', { name: 'Loading transcript' })).toBeInTheDocument()
  })

  it('opens straight from a link, as an alert would', async () => {
    renderReceptionist('/receptionist/shop-1?call=call-1')

    const dialog = within(await screen.findByRole('dialog', { name: 'Devon Hill' }))
    expect(await dialog.findAllByRole('listitem')).toHaveLength(3)
    expect(api.getCall).toHaveBeenCalledWith('call-1')
  })

  it('shows a placeholder while a linked call loads', async () => {
    api.listCalls.mockResolvedValue([])
    api.getCall.mockReturnValue(new Promise(() => {}))
    renderReceptionist('/receptionist/shop-1?call=call-1')

    const dialog = within(await screen.findByRole('dialog', { name: 'Call' }))
    expect(dialog.getByRole('status', { name: 'Loading call' })).toBeInTheDocument()
  })

  it('keeps the filter when a call is opened', async () => {
    const user = userEvent.setup()
    renderReceptionist('/receptionist/shop-1?filter=problems')

    await user.click(await callRow(/555-0177/))

    await screen.findByRole('dialog', { name: '(512) 555-0177' })
    expect(location()).toHaveTextContent('/receptionist/shop-1?filter=problems&call=call-2')
  })

  it('explains a missed call that has no conversation', async () => {
    renderReceptionist('/receptionist/shop-1?call=call-2')

    // Nobody to name: the number is the title.
    const dialog = within(await screen.findByRole('dialog', { name: '(512) 555-0177' }))
    expect(
      await dialog.findByText('No conversation. The caller hung up before Jarvis could answer.'),
    ).toBeInTheDocument()
    expect(dialog.getByText('Missed')).toBeInTheDocument()
    expect(dialog.queryByRole('listitem')).not.toBeInTheDocument()
    expect(dialog.queryByText(/Lasted/)).not.toBeInTheDocument()
    expect(dialog.getByRole('link', { name: 'Call back' })).toHaveAttribute('href', 'tel:+15125550177')
  })

  it('says when the call is gone, with nothing to retry', async () => {
    renderReceptionist('/receptionist/shop-1?call=deleted')

    const dialog = within(await screen.findByRole('dialog', { name: 'Call' }))
    expect(await dialog.findByText('This call is no longer available.')).toBeInTheDocument()
    expect(dialog.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    expect(dialog.queryByRole('link', { name: 'Call back' })).not.toBeInTheDocument()
  })

  it('offers a retry when the call fails to load', async () => {
    const user = userEvent.setup()
    let online = false
    api.getCall.mockImplementation(async () => {
      if (!online) throw new Error('The connection dropped.')
      return booked
    })
    renderReceptionist('/receptionist/shop-1?call=call-1')

    const dialog = within(await screen.findByRole('dialog'))
    const alert = await dialog.findByRole('alert')
    expect(alert).toHaveTextContent('Couldn’t load this call.')
    expect(alert).toHaveTextContent('The connection dropped.')

    online = true
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))

    expect(await dialog.findAllByRole('listitem')).toHaveLength(3)
  })

  describe('closing', () => {
    it('takes the call out of the URL and keeps the filter', async () => {
      const user = userEvent.setup()
      renderReceptionist('/receptionist/shop-1?filter=problems&call=call-2')

      const dialog = await screen.findByRole('dialog', { name: '(512) 555-0177' })
      await user.click(within(dialog).getByRole('button', { name: 'Close' }))

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(location()).toHaveTextContent(/^\/receptionist\/shop-1\?filter=problems$/)
    })

    it('closes a linked call in place, so Back returns to where the link was followed from', async () => {
      const user = userEvent.setup()
      renderReceptionist('/receptionist', '/receptionist/shop-1?call=call-1')

      const dialog = await screen.findByRole('dialog', { name: 'Devon Hill' })
      await user.click(within(dialog).getByRole('button', { name: 'Close' }))
      await waitFor(() => expect(location()).toHaveTextContent(/^\/receptionist\/shop-1$/))

      await user.click(screen.getByRole('button', { name: 'Browser back' }))
      await waitFor(() => expect(location()).toHaveTextContent(/^\/receptionist$/))
    })

    it('closes with the browser’s Back button after opening from the list', async () => {
      const user = userEvent.setup()
      renderReceptionist('/receptionist/shop-1')

      await user.click(await callRow(/Devon Hill/))
      await screen.findByRole('dialog', { name: 'Devon Hill' })

      await user.click(screen.getByRole('button', { name: 'Browser back' }))

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(location()).toHaveTextContent(/^\/receptionist\/shop-1$/)
    })

    it('leaves nothing behind in history after opening and closing calls', async () => {
      const user = userEvent.setup()
      renderReceptionist('/receptionist', '/receptionist/shop-1')

      for (const name of [/Devon Hill/, /555-0177/]) {
        await user.click(await callRow(name))
        const dialog = await screen.findByRole('dialog')
        await user.click(within(dialog).getByRole('button', { name: 'Close' }))
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        expect(location()).toHaveTextContent(/^\/receptionist\/shop-1$/)
      }

      // One Back leaves the shop: closing did not stack up copies of it.
      await user.click(screen.getByRole('button', { name: 'Browser back' }))
      await waitFor(() => expect(location()).toHaveTextContent(/^\/receptionist$/))
    })
  })
})
