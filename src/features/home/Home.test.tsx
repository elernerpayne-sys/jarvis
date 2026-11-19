import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Alert, Approval, Brief } from '@/lib/types'
import { ToastProvider } from '@/components/ui/Toast'
import Home from '@/features/home'

const service = vi.hoisted(() => ({
  mode: 'demo' as 'demo' | 'live',
  getBrief: vi.fn(),
  listApprovals: vi.fn(),
  decideApproval: vi.fn(),
  listAlerts: vi.fn(),
  markAlertRead: vi.fn(),
  markAllAlertsRead: vi.fn(),
}))

vi.mock('@/services', async () => {
  const errors = await vi.importActual<typeof import('@/services/errors')>('@/services/errors')
  return { ...errors, api: service }
})

// The voice feature is someone else's; Home only has to put it on screen.
vi.mock('@/features/voice', () => ({
  TalkPanel: () => <div data-testid="talk-panel" />,
}))

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

const brief: Brief = {
  date: '2026-11-19',
  calls_answered: 12,
  bookings_made: 5,
  missed_calls: 1,
  tasks_finished: 3,
}

function approval(id: string, title: string, requestedMinutesAgo: number): Approval {
  const requested_at = minutesAgo(requestedMinutesAgo)
  return {
    id,
    kind: 'code',
    title,
    detail: null,
    task_id: null,
    shop_id: null,
    status: 'pending',
    requested_at,
    decided_at: null,
    expires_at: null,
    created_at: requested_at,
  }
}

// As the service returns them: newest first.
const approvals: Approval[] = [
  approval('ap-3', 'Refund the double booking?', 2),
  approval('ap-2', 'Push the booking fix?', 30),
  approval('ap-1', 'Spend $40 on the SMS top-up?', 180),
]

function alert(id: string, title: string, fields: Partial<Alert> = {}): Alert {
  return {
    id,
    type: 'system',
    title,
    body: null,
    shop_id: null,
    call_id: null,
    task_id: null,
    approval_id: null,
    channel: 'in_app',
    read_at: null,
    created_at: minutesAgo(1),
    ...fields,
  }
}

const taskAlert = alert('al-3', 'Booking fix is ready', {
  type: 'task_done',
  body: 'Jarvis opened a pull request.',
  task_id: 'task-7',
  channel: 'text',
  created_at: minutesAgo(4),
})
const callAlert = alert('al-2', 'Missed call at Fade Factory', {
  type: 'missed_call',
  body: 'The caller hung up before the greeting.',
  shop_id: 'shop-1',
  call_id: 'call-9',
  channel: 'call',
  created_at: minutesAgo(50),
})
const readAlert = alert('al-1', 'Notion is not set up', {
  body: 'Add a key to start syncing the handbook.',
  read_at: minutesAgo(90),
  created_at: minutesAgo(120),
})

/** Stands in for the other screens, and says where we ended up. */
function Elsewhere() {
  const location = useLocation()
  return <p>Now at {location.pathname + location.search}</p>
}

function renderHome() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ToastProvider>
          <Routes>
            <Route index element={<Home />} />
            <Route path="*" element={<Elsewhere />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { queryClient }
}

/** A request that stays in flight, to hold a screen in its loading state. */
const never = () => new Promise<never>(() => {})

async function openAlerts(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Alerts' }))
  return screen.getByRole('dialog', { name: 'Alerts' })
}

beforeEach(() => {
  service.mode = 'demo'
  service.getBrief.mockResolvedValue(brief)
  service.listApprovals.mockResolvedValue(approvals)
  service.listAlerts.mockResolvedValue([taskAlert, callAlert, readAlert])
  service.markAlertRead.mockResolvedValue(undefined)
  service.markAllAlertsRead.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Home', () => {
  it('greets the owner with the date and the time of day', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 19, 9, 30))
    renderHome()

    expect(screen.getByRole('heading', { level: 1, name: 'Good morning.' })).toBeInTheDocument()
    expect(screen.getByText('Thursday, November 19')).toBeInTheDocument()
  })

  it('gives the Talk panel a place on the screen', () => {
    renderHome()
    expect(screen.getByTestId('talk-panel')).toBeInTheDocument()
  })

  it('says so when everything is sample data', () => {
    renderHome()
    expect(screen.getByText('Demo mode. Everything here is sample data.')).toBeInTheDocument()
  })

  it('does not mention demo mode once the real services are connected', () => {
    service.mode = 'live'
    renderHome()
    expect(screen.queryByText(/Demo mode/)).not.toBeInTheDocument()
  })
})

describe('Today’s brief', () => {
  it('shows the four numbers, each linking to where it comes from', async () => {
    renderHome()
    const strip = await screen.findByRole('list', { name: 'Today' })

    const expected = [
      { name: '12 calls answered', figure: '12', label: 'Answered', href: '/receptionist' },
      { name: '5 appointments booked', figure: '5', label: 'Booked', href: '/receptionist' },
      { name: '1 call missed', figure: '1', label: 'Missed', href: '/receptionist' },
      { name: '3 tasks done', figure: '3', label: 'Tasks done', href: '/code' },
    ]
    const links = within(strip).getAllByRole('link')
    expect(links).toHaveLength(expected.length)
    expected.forEach(({ name, figure, label, href }, index) => {
      expect(links[index]).toHaveAccessibleName(name)
      expect(links[index]).toHaveAttribute('href', href)
      expect(within(links[index]).getByText(figure)).toBeInTheDocument()
      expect(within(links[index]).getByText(label)).toBeInTheDocument()
    })
  })

  it('turns the missed figure red when calls were missed', async () => {
    service.getBrief.mockResolvedValue({ ...brief, missed_calls: 2 })
    renderHome()

    const missed = await screen.findByRole('link', { name: '2 calls missed' })
    expect(within(missed).getByText('2')).toHaveClass('text-bad')
    // The other figures never do.
    const answered = screen.getByRole('link', { name: '12 calls answered' })
    expect(within(answered).getByText('12')).not.toHaveClass('text-bad')
  })

  it('keeps the missed figure calm at zero', async () => {
    service.getBrief.mockResolvedValue({ ...brief, missed_calls: 0 })
    renderHome()

    const missed = await screen.findByRole('link', { name: '0 calls missed' })
    expect(within(missed).getByText('0')).not.toHaveClass('text-bad')
  })

  it('shows placeholders while the numbers load', () => {
    service.getBrief.mockImplementation(never)
    renderHome()

    expect(screen.getByRole('status', { name: 'Loading today’s numbers' })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Today' })).not.toBeInTheDocument()
  })

  it('says what went wrong and loads again on retry', async () => {
    const user = userEvent.setup()
    service.getBrief.mockRejectedValueOnce(new Error('The connection dropped.'))
    renderHome()

    const failure = await screen.findByRole('alert')
    expect(failure).toHaveTextContent('Couldn’t load today’s numbers.')
    expect(failure).toHaveTextContent('The connection dropped.')

    await user.click(within(failure).getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('link', { name: '12 calls answered' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('Needs your approval', () => {
  it('asks only for requests that are still pending', async () => {
    renderHome()
    await screen.findByText('Push the booking fix?')
    expect(service.listApprovals).toHaveBeenCalledWith({ status: 'pending' })
  })

  it('lists them with the longest-waiting request on top, and counts them', async () => {
    renderHome()
    await screen.findByText('Push the booking fix?')

    const titles = screen.getAllByText(/\?$/).map((title) => title.textContent)
    expect(titles).toEqual([
      'Spend $40 on the SMS top-up?',
      'Push the booking fix?',
      'Refund the double booking?',
    ])
    expect(screen.getByRole('heading', { name: /^Needs your approval\s*3$/ })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Approve' })).toHaveLength(3)
  })

  it('says nothing is waiting when there are none', async () => {
    service.listApprovals.mockResolvedValue([])
    renderHome()

    expect(await screen.findByText('Nothing is waiting on you.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Needs your approval' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
  })

  it('shows a placeholder card while they load', () => {
    service.listApprovals.mockImplementation(never)
    renderHome()

    expect(screen.getByRole('status', { name: 'Loading approvals' })).toBeInTheDocument()
  })

  it('says what went wrong and loads again on retry', async () => {
    const user = userEvent.setup()
    service.listApprovals.mockRejectedValueOnce(new Error('The connection dropped.'))
    renderHome()

    const failure = await screen.findByRole('alert')
    expect(failure).toHaveTextContent('Couldn’t load approvals.')
    expect(failure).toHaveTextContent('The connection dropped.')

    await user.click(within(failure).getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Push the booking fix?')).toBeInTheDocument()
  })

  it('announces a request that arrives later, but not the first load', async () => {
    service.listApprovals.mockResolvedValue([approvals[1]])
    const { queryClient } = renderHome()

    const section = screen.getByRole('heading', { name: 'Needs your approval' }).closest('[aria-relevant]')
    // Not live yet: the first load must not be read out.
    expect(section).not.toHaveAttribute('aria-live')
    await screen.findByText('Push the booking fix?')
    await waitFor(() => expect(section).toHaveAttribute('aria-live', 'polite'))

    service.listApprovals.mockResolvedValue([approvals[0], approvals[1]])
    await queryClient.invalidateQueries({ queryKey: ['approvals'] })

    expect(await within(section as HTMLElement).findByText('Refund the double booking?')).toBeInTheDocument()
  })
})

describe('Alerts', () => {
  it('flags unread alerts on the bell', async () => {
    renderHome()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Alerts' })).toHaveAccessibleDescription('2 unread'),
    )
  })

  it('leaves the bell plain when everything has been read', async () => {
    service.listAlerts.mockResolvedValue([readAlert])
    renderHome()
    await screen.findByRole('list', { name: 'Today' })
    await waitFor(() => expect(service.listAlerts).toHaveBeenCalled())

    expect(screen.getByRole('button', { name: 'Alerts' })).not.toHaveAccessibleDescription(/unread/)
  })

  it('opens a list of alerts, newest first, with how each one reached the owner', async () => {
    const user = userEvent.setup()
    renderHome()
    const dialog = await openAlerts(user)

    const rows = await within(dialog).findAllByRole('listitem')
    expect(rows).toHaveLength(3)

    expect(rows[0]).toHaveTextContent('Booking fix is ready')
    expect(rows[0]).toHaveTextContent('Jarvis opened a pull request.')
    expect(rows[0]).toHaveTextContent('Texted you')
    expect(rows[0]).toHaveTextContent('4m ago')

    expect(rows[1]).toHaveTextContent('Missed call at Fade Factory')
    expect(rows[1]).toHaveTextContent('Called you')

    expect(rows[2]).toHaveTextContent('Notion is not set up')
    expect(rows[2]).toHaveTextContent('In the app')
  })

  it('tells unread alerts from read ones', async () => {
    const user = userEvent.setup()
    renderHome()
    const dialog = await openAlerts(user)

    expect(await within(dialog).findByRole('button', { name: /^Unread\.\s*Booking fix is ready/ })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /^Notion is not set up/ })).toBeInTheDocument()
  })

  it('marks an alert read and opens what it is about', async () => {
    const user = userEvent.setup()
    renderHome()
    const dialog = await openAlerts(user)

    await user.click(await within(dialog).findByRole('button', { name: /Booking fix is ready/ }))

    expect(service.markAlertRead).toHaveBeenCalledWith('al-3')
    expect(await screen.findByText('Now at /code/task-7')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens the call an alert is about', async () => {
    const user = userEvent.setup()
    renderHome()
    const dialog = await openAlerts(user)

    await user.click(await within(dialog).findByRole('button', { name: /Missed call at Fade Factory/ }))

    expect(await screen.findByText('Now at /receptionist/shop-1?call=call-9')).toBeInTheDocument()
  })

  it('closes the sheet without marking anything when the alert was already read', async () => {
    const user = userEvent.setup()
    renderHome()
    const dialog = await openAlerts(user)

    await user.click(await within(dialog).findByRole('button', { name: /Notion is not set up/ }))

    expect(service.markAlertRead).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // It is about nothing in particular, so we stay on Home.
    expect(screen.getByTestId('talk-panel')).toBeInTheDocument()
  })

  it('marks everything read in one press', async () => {
    const user = userEvent.setup()
    renderHome()
    const dialog = await openAlerts(user)
    const markAll = await within(dialog).findByRole('button', { name: 'Mark all read' })
    expect(within(dialog).getByText('2 unread')).toBeInTheDocument()

    const now = new Date().toISOString()
    service.listAlerts.mockResolvedValue([taskAlert, callAlert, readAlert].map((item) => ({ ...item, read_at: now })))
    await user.click(markAll)

    expect(service.markAllAlertsRead).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(within(dialog).queryByRole('button', { name: 'Mark all read' })).not.toBeInTheDocument(),
    )
    expect(within(dialog).queryByText(/unread/i)).not.toBeInTheDocument()
  })

  it('does not offer "Mark all read" when nothing is unread', async () => {
    const user = userEvent.setup()
    service.listAlerts.mockResolvedValue([readAlert])
    renderHome()
    const dialog = await openAlerts(user)

    expect(await within(dialog).findByText('Notion is not set up')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Mark all read' })).not.toBeInTheDocument()
  })

  it('says so in the sheet when marking everything read fails', async () => {
    const user = userEvent.setup()
    service.markAllAlertsRead.mockRejectedValue(new Error('The connection dropped.'))
    renderHome()
    const dialog = await openAlerts(user)

    await user.click(await within(dialog).findByRole('button', { name: 'Mark all read' }))

    const failure = await within(dialog).findByRole('alert')
    expect(failure).toHaveTextContent('Couldn’t mark alerts read. The connection dropped.')
    expect(within(dialog).getByRole('button', { name: 'Mark all read' })).toBeEnabled()
  })

  it('says there is nothing to see when there are no alerts', async () => {
    const user = userEvent.setup()
    service.listAlerts.mockResolvedValue([])
    renderHome()
    const dialog = await openAlerts(user)

    expect(await within(dialog).findByText('No alerts.')).toBeInTheDocument()
    expect(within(dialog).getByText('Jarvis will flag anything that needs you.')).toBeInTheDocument()
  })

  it('shows placeholder rows while alerts load', async () => {
    const user = userEvent.setup()
    service.listAlerts.mockImplementation(never)
    renderHome()
    const dialog = await openAlerts(user)

    expect(within(dialog).getByRole('status', { name: 'Loading alerts' })).toBeInTheDocument()
  })

  it('says what went wrong in the sheet and loads again on retry', async () => {
    const user = userEvent.setup()
    service.listAlerts.mockRejectedValue(new Error('The connection dropped.'))
    renderHome()
    const dialog = await openAlerts(user)

    const failure = await within(dialog).findByRole('alert')
    expect(failure).toHaveTextContent('Couldn’t load alerts.')
    expect(failure).toHaveTextContent('The connection dropped.')

    service.listAlerts.mockResolvedValue([taskAlert, callAlert, readAlert])
    await user.click(within(failure).getByRole('button', { name: 'Try again' }))

    expect(await within(dialog).findByText('Booking fix is ready')).toBeInTheDocument()
  })
})
