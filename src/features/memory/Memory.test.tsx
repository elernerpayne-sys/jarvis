import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { formatDateOnly, localDate } from '@/lib/format'
import type { Decision, DecisionInput, HandbookEntry, HandbookEntryInput } from '@/lib/types'
import { ToastProvider } from '@/components/ui/Toast'
import Memory from '@/features/memory'

const service = vi.hoisted(() => ({
  listHandbookEntries: vi.fn(),
  saveHandbookEntry: vi.fn(),
  deleteHandbookEntry: vi.fn(),
  listDecisions: vi.fn(),
  saveDecision: vi.fn(),
  deleteDecision: vi.fn(),
}))

vi.mock('@/services', async () => {
  const errors = await vi.importActual<typeof import('@/services/errors')>('@/services/errors')
  return { ...errors, api: { mode: 'demo', ...service } }
})

const DEPOSIT_CONTENT = [
  'Take a $10 deposit from anyone booking for the first time.',
  'Returning clients never pay one, even after a no-show; note it on the booking instead.',
  'If a caller refuses, offer a walk-in slot and do not hold a chair.',
  'The deposit comes off the price of the cut on the day.',
].join('\n')

const deposit: HandbookEntry = {
  id: 'hb-deposit',
  title: 'Deposit policy',
  category: 'Policies',
  content: DEPOSIT_CONTENT,
  tags: ['deposits', 'new clients'],
  notion_page_id: 'notion-page-1',
  created_at: '2026-10-01T15:00:00.000Z',
  updated_at: '2026-11-10T15:00:00.000Z',
}

const haircuts: HandbookEntry = {
  id: 'hb-haircuts',
  title: 'Haircut prices',
  category: 'Pricing',
  content: 'Cut $35. Skin fade $40. Kids under 12 $25.',
  tags: ['prices'],
  notion_page_id: null,
  created_at: '2026-10-01T15:00:00.000Z',
  updated_at: '2026-11-12T15:00:00.000Z',
}

const beards: HandbookEntry = {
  id: 'hb-beards',
  title: 'Beard trim prices',
  category: 'Pricing',
  content: 'Beard trim $15. Hot towel shave $30.',
  tags: ['prices'],
  notion_page_id: null,
  created_at: '2026-10-01T15:00:00.000Z',
  updated_at: '2026-11-03T15:00:00.000Z',
}

const greeting: HandbookEntry = {
  id: 'hb-greeting',
  title: 'How to answer the phone',
  category: 'Phone scripts',
  content: 'Say the shop name first. We are closed on Mondays.',
  tags: [],
  notion_page_id: null,
  created_at: '2026-10-01T15:00:00.000Z',
  updated_at: '2026-11-01T15:00:00.000Z',
}

const mondays: Decision = {
  id: 'dc-mondays',
  title: 'Close on Mondays',
  decision: 'Both shops stay closed on Mondays from November.',
  rationale: 'Mondays brought in under five cuts a day and the barbers asked for a fixed day off.',
  decided_on: '2026-10-20',
  tags: ['hours'],
  notion_page_id: 'notion-page-2',
  created_at: '2026-10-20T15:00:00.000Z',
  updated_at: '2026-10-20T15:00:00.000Z',
}

const receptionist: Decision = {
  id: 'dc-receptionist',
  title: 'Let Jarvis book without calling back',
  decision: 'Jarvis books straight into the calendar.',
  rationale: null,
  decided_on: '2026-11-05',
  tags: [],
  notion_page_id: null,
  created_at: '2026-11-05T15:00:00.000Z',
  updated_at: '2026-11-05T15:00:00.000Z',
}

/** Shows the current address so tests can read it. */
function Address() {
  const { pathname, search } = useLocation()
  return <span data-testid="address">{pathname + search}</span>
}

function address() {
  return screen.getByTestId('address').textContent
}

function renderMemory(at = '/memory') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[at]}>
        <ToastProvider>
          <Routes>
            <Route path="memory/*" element={<Memory />} />
          </Routes>
          <Address />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** A list row is a button named after everything in it; the title is enough. */
function row(title: string) {
  return screen.findByRole('button', { name: new RegExp(title) })
}

function expectNoSheet() {
  return waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
}

beforeEach(() => {
  for (const method of Object.values(service)) method.mockReset()
  service.listHandbookEntries.mockResolvedValue([deposit, haircuts, beards, greeting])
  service.listDecisions.mockResolvedValue([receptionist, mondays])
  service.saveHandbookEntry.mockImplementation(async (input: HandbookEntryInput) => ({
    ...deposit,
    ...input,
    id: input.id ?? 'hb-new',
    updated_at: new Date().toISOString(),
  }))
  service.saveDecision.mockImplementation(async (input: DecisionInput) => ({
    ...mondays,
    ...input,
    id: input.id ?? 'dc-new',
    updated_at: new Date().toISOString(),
  }))
  service.deleteHandbookEntry.mockResolvedValue(undefined)
  service.deleteDecision.mockResolvedValue(undefined)
})

describe('Memory tabs', () => {
  it('opens on the handbook and keeps the chosen tab in the address', async () => {
    const user = userEvent.setup()
    renderMemory()

    expect(await row('Deposit policy')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Handbook' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Add entry' })).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Search the handbook' })).toBeInTheDocument()
    expect(address()).toBe('/memory')

    await user.click(screen.getByRole('radio', { name: 'Decisions' }))

    expect(address()).toBe('/memory?tab=decisions')
    expect(await row('Close on Mondays')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Deposit policy/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add decision' })).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Search decisions' })).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Handbook' }))

    expect(address()).toBe('/memory')
    expect(await row('Deposit policy')).toBeInTheDocument()
  })

  it('opens straight on decisions from a link, and leaves the rest of the address alone', async () => {
    const user = userEvent.setup()
    renderMemory('/memory?tab=decisions&demo=slow')

    expect(await row('Close on Mondays')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Decisions' })).toBeChecked()

    await user.click(screen.getByRole('radio', { name: 'Handbook' }))
    expect(address()).toBe('/memory?demo=slow')
  })
})

describe('Memory search', () => {
  it('filters the handbook as you type', async () => {
    const user = userEvent.setup()
    renderMemory()
    await row('Deposit policy')

    await user.type(screen.getByRole('searchbox', { name: 'Search the handbook' }), 'new clients')

    expect(screen.getByRole('button', { name: /Deposit policy/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Haircut prices/ })).not.toBeInTheDocument()
    // A category with no matches disappears with its entries.
    expect(screen.queryByRole('heading', { name: 'Pricing' })).not.toBeInTheDocument()
    expect(screen.getByText('1 entry found.')).toBeInTheDocument()
  })

  it('says when nothing matches, which is not the same as an empty handbook', async () => {
    const user = userEvent.setup()
    renderMemory()
    await row('Deposit policy')

    const search = screen.getByRole('searchbox', { name: 'Search the handbook' })
    await user.type(search, 'zebra')

    expect(screen.getByText('Nothing matches “zebra”.')).toBeInTheDocument()
    expect(screen.queryByText('The handbook is empty.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Deposit policy/ })).not.toBeInTheDocument()

    // The message has its own way out, next to the × in the search box.
    await user.click(screen.getByText('Clear search'))

    expect(search).toHaveValue('')
    expect(screen.getByRole('button', { name: /Deposit policy/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Haircut prices/ })).toBeInTheDocument()
  })

  it('keeps what you typed when you switch tabs, and filters decisions too', async () => {
    const user = userEvent.setup()
    renderMemory()
    await row('Deposit policy')

    await user.type(screen.getByRole('searchbox', { name: 'Search the handbook' }), 'mondays')
    expect(screen.getByRole('button', { name: /How to answer the phone/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Deposit policy/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Decisions' }))

    const search = screen.getByRole('searchbox', { name: 'Search decisions' })
    expect(search).toHaveValue('mondays')
    expect(await row('Close on Mondays')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Let Jarvis book/ })).not.toBeInTheDocument()

    await user.clear(search)
    await user.type(search, 'zebra')
    expect(screen.getByText('Nothing matches “zebra”.')).toBeInTheDocument()
    expect(screen.queryByText('No decisions logged yet.')).not.toBeInTheDocument()
  })
})

describe('Handbook', () => {
  it('groups entries under their category, A to Z, newest first inside', async () => {
    renderMemory()
    await row('Deposit policy')

    const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
    expect(headings).toEqual(['Phone scripts', 'Policies', 'Pricing'])

    const pricing = within(screen.getByRole('region', { name: 'Pricing' })).getAllByRole('button')
    expect(pricing).toHaveLength(2)
    expect(pricing[0]).toHaveTextContent('Haircut prices')
    expect(pricing[1]).toHaveTextContent('Beard trim prices')
    expect(
      within(screen.getByRole('region', { name: 'Policies' })).getByRole('button', { name: /Deposit policy/ }),
    ).toBeInTheDocument()
  })

  it('opens an entry for reading, with everything it says', async () => {
    const user = userEvent.setup()
    renderMemory()

    await user.click(await row('Deposit policy'))

    const sheet = screen.getByRole('dialog', { name: 'Deposit policy' })
    // The row only shows the start; the sheet shows the last line too.
    expect(within(sheet).getByText(/The deposit comes off the price of the cut on the day\./)).toBeInTheDocument()
    const labels = within(sheet).getByRole('list', { name: 'Category and tags' })
    expect(within(labels).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Policies',
      'deposits',
      'new clients',
    ])
    expect(within(sheet).getByText('Synced with Notion')).toBeInTheDocument()
    // Reading comes first: no form until "Edit" is pressed.
    expect(within(sheet).queryByRole('textbox')).not.toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Edit' })).toBeInTheDocument()

    await user.click(within(sheet).getByText('Close'))
    await expectNoSheet()
  })

  it('says when an entry is not in Notion yet', async () => {
    const user = userEvent.setup()
    renderMemory()

    await user.click(await row('Haircut prices'))

    const sheet = screen.getByRole('dialog', { name: 'Haircut prices' })
    expect(within(sheet).getByText('Not in Notion yet. Sync comes later.')).toBeInTheDocument()
    expect(within(sheet).queryByText('Synced with Notion')).not.toBeInTheDocument()
  })

  it('adds an entry once it has a title and content, with the tags split up', async () => {
    const user = userEvent.setup()
    renderMemory()
    await row('Deposit policy')

    await user.click(screen.getByRole('button', { name: 'Add entry' }))
    const sheet = screen.getByRole('dialog', { name: 'New entry' })
    const title = within(sheet).getByLabelText('Title')
    expect(title).toHaveFocus()

    await user.click(within(sheet).getByRole('button', { name: 'Save entry' }))

    expect(within(sheet).getByText('Give the entry a title.')).toBeInTheDocument()
    expect(within(sheet).getByText('Write what Jarvis should know.')).toBeInTheDocument()
    expect(title).toHaveAttribute('aria-invalid', 'true')
    expect(title).toHaveFocus()
    expect(service.saveHandbookEntry).not.toHaveBeenCalled()

    await user.type(title, 'Walk-ins')
    // Fixing a field clears its message without waiting for another save.
    expect(within(sheet).queryByText('Give the entry a title.')).not.toBeInTheDocument()
    await user.type(within(sheet).getByLabelText('Category'), 'Policies')
    await user.type(within(sheet).getByLabelText('Content'), 'Take walk-ins when a chair is free.')
    await user.type(within(sheet).getByLabelText('Tags'), 'a, b ,, c')

    const preview = within(sheet).getByRole('list', { name: 'Tags as they will be saved' })
    expect(within(preview).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['a', 'b', 'c'])

    await user.click(within(sheet).getByRole('button', { name: 'Save entry' }))

    await waitFor(() =>
      expect(service.saveHandbookEntry).toHaveBeenCalledWith({
        title: 'Walk-ins',
        category: 'Policies',
        content: 'Take walk-ins when a chair is free.',
        tags: ['a', 'b', 'c'],
      }),
    )
    expect(await screen.findByText('Entry saved')).toBeInTheDocument()
    await expectNoSheet()
  })

  it('offers the categories already in use while typing one', async () => {
    const user = userEvent.setup()
    renderMemory()
    await row('Deposit policy')

    await user.click(screen.getByRole('button', { name: 'Add entry' }))
    const category = within(screen.getByRole('dialog', { name: 'New entry' })).getByLabelText('Category')

    const suggestions = document.getElementById(category.getAttribute('list') ?? '')
    expect(suggestions?.tagName).toBe('DATALIST')
    expect([...(suggestions?.querySelectorAll('option') ?? [])].map((option) => option.value)).toEqual([
      'Phone scripts',
      'Policies',
      'Pricing',
    ])
  })

  it('opens the form on "Edit" without saving anything', async () => {
    const user = userEvent.setup()
    renderMemory()

    await user.click(await row('Deposit policy'))
    await user.click(within(screen.getByRole('dialog', { name: 'Deposit policy' })).getByRole('button', { name: 'Edit' }))

    const form = screen.getByRole('dialog', { name: 'Edit entry' })
    expect(within(form).getByRole('button', { name: 'Save entry' })).toBeEnabled()
    expect(service.saveHandbookEntry).not.toHaveBeenCalled()
  })

  it('edits an entry in place and goes back to reading it', async () => {
    const user = userEvent.setup()
    renderMemory()

    await user.click(await row('Deposit policy'))
    await user.click(within(screen.getByRole('dialog', { name: 'Deposit policy' })).getByRole('button', { name: 'Edit' }))

    const form = screen.getByRole('dialog', { name: 'Edit entry' })
    const title = within(form).getByLabelText('Title')
    expect(title).toHaveValue('Deposit policy')
    expect(within(form).getByLabelText('Category')).toHaveValue('Policies')
    expect(within(form).getByLabelText('Content')).toHaveValue(DEPOSIT_CONTENT)
    expect(within(form).getByLabelText('Tags')).toHaveValue('deposits, new clients')

    await user.clear(title)
    await user.type(title, 'Deposits')
    await user.click(within(form).getByRole('button', { name: 'Save entry' }))

    await waitFor(() =>
      expect(service.saveHandbookEntry).toHaveBeenCalledWith({
        id: 'hb-deposit',
        title: 'Deposits',
        category: 'Policies',
        content: DEPOSIT_CONTENT,
        tags: ['deposits', 'new clients'],
      }),
    )
    // The Notion link is the service's to keep; the form never sends it.
    expect(service.saveHandbookEntry.mock.calls[0]?.[0]).not.toHaveProperty('notion_page_id')

    const sheet = await screen.findByRole('dialog', { name: 'Deposits' })
    expect(within(sheet).getByText('Saved')).toBeInTheDocument()
    expect(within(sheet).getByText('Synced with Notion')).toBeInTheDocument()
    expect(within(sheet).queryByRole('textbox')).not.toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Edit' })).toHaveFocus()
    expect(await screen.findByText('Entry saved')).toBeInTheDocument()
  })

  it('asks before deleting an entry', async () => {
    const user = userEvent.setup()
    renderMemory()

    await user.click(await row('Deposit policy'))
    await user.click(within(screen.getByRole('dialog', { name: 'Deposit policy' })).getByRole('button', { name: 'Edit' }))
    const form = screen.getByRole('dialog', { name: 'Edit entry' })

    await user.click(within(form).getByRole('button', { name: 'Delete entry' }))

    const confirm = screen.getByRole('dialog', { name: 'Delete this entry?' })
    expect(within(confirm).getByText('It is removed from Jarvis’s memory. This can’t be undone.')).toBeInTheDocument()
    expect(service.deleteHandbookEntry).not.toHaveBeenCalled()

    await user.click(within(confirm).getByRole('button', { name: 'Go back' }))
    expect(service.deleteHandbookEntry).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Edit entry' })).toBeInTheDocument()

    await user.click(within(form).getByRole('button', { name: 'Delete entry' }))
    await user.click(
      within(screen.getByRole('dialog', { name: 'Delete this entry?' })).getByRole('button', { name: 'Delete entry' }),
    )

    await waitFor(() => expect(service.deleteHandbookEntry).toHaveBeenCalledWith('hb-deposit'))
    expect(await screen.findByText('Entry deleted')).toBeInTheDocument()
    await expectNoSheet()
  })

  it('says why a delete failed and keeps the entry open', async () => {
    const user = userEvent.setup()
    service.deleteHandbookEntry.mockRejectedValue(new Error('The backend did not answer.'))
    renderMemory()

    await user.click(await row('Deposit policy'))
    await user.click(within(screen.getByRole('dialog', { name: 'Deposit policy' })).getByRole('button', { name: 'Edit' }))
    await user.click(
      within(screen.getByRole('dialog', { name: 'Edit entry' })).getByRole('button', { name: 'Delete entry' }),
    )
    const confirm = screen.getByRole('dialog', { name: 'Delete this entry?' })
    await user.click(within(confirm).getByRole('button', { name: 'Delete entry' }))

    expect(await within(confirm).findByRole('alert')).toHaveTextContent(
      'Couldn’t delete the entry. The backend did not answer.',
    )
    expect(screen.getByRole('dialog', { name: 'Edit entry' })).toBeInTheDocument()
    expect(screen.queryByText('Entry deleted')).not.toBeInTheDocument()
  })

  it('keeps everything you typed when saving fails', async () => {
    const user = userEvent.setup()
    service.saveHandbookEntry.mockRejectedValueOnce(new Error('The backend did not answer.'))
    renderMemory()
    await row('Deposit policy')

    await user.click(screen.getByRole('button', { name: 'Add entry' }))
    const sheet = screen.getByRole('dialog', { name: 'New entry' })
    await user.type(within(sheet).getByLabelText('Title'), 'Walk-ins')
    await user.type(within(sheet).getByLabelText('Content'), 'Take walk-ins when a chair is free.')
    await user.click(within(sheet).getByRole('button', { name: 'Save entry' }))

    expect(await within(sheet).findByRole('alert')).toHaveTextContent(
      'Couldn’t save the entry. The backend did not answer.',
    )
    expect(within(sheet).getByLabelText('Title')).toHaveValue('Walk-ins')
    expect(within(sheet).getByLabelText('Content')).toHaveValue('Take walk-ins when a chair is free.')
    expect(screen.queryByText('Entry saved')).not.toBeInTheDocument()

    // Trying again works without retyping anything.
    await user.click(within(sheet).getByRole('button', { name: 'Save entry' }))
    expect(await screen.findByText('Entry saved')).toBeInTheDocument()
    expect(service.saveHandbookEntry).toHaveBeenCalledTimes(2)
    await expectNoSheet()
  })

  it('asks before throwing away a new entry you started', async () => {
    const user = userEvent.setup()
    renderMemory()
    await row('Deposit policy')

    await user.click(screen.getByRole('button', { name: 'Add entry' }))
    const sheet = screen.getByRole('dialog', { name: 'New entry' })
    await user.type(within(sheet).getByLabelText('Title'), 'Half a thought')
    await user.click(within(sheet).getByRole('button', { name: 'Cancel' }))

    const confirm = screen.getByRole('dialog', { name: 'Discard your changes?' })
    await user.click(within(confirm).getByRole('button', { name: 'Keep editing' }))

    expect(screen.queryByRole('dialog', { name: 'Discard your changes?' })).not.toBeInTheDocument()
    expect(within(sheet).getByLabelText('Title')).toHaveValue('Half a thought')

    // The × asks as well.
    await user.click(within(sheet).getByRole('button', { name: 'Close' }))
    await user.click(
      within(screen.getByRole('dialog', { name: 'Discard your changes?' })).getByRole('button', { name: 'Discard' }),
    )

    await expectNoSheet()
    expect(service.saveHandbookEntry).not.toHaveBeenCalled()
  })

  it('does not ask when nothing was typed', async () => {
    const user = userEvent.setup()
    renderMemory()
    await row('Deposit policy')

    await user.click(screen.getByRole('button', { name: 'Add entry' }))
    await user.click(within(screen.getByRole('dialog', { name: 'New entry' })).getByRole('button', { name: 'Cancel' }))

    await expectNoSheet()
  })

  it('goes back to the entry as it was when an edit is discarded', async () => {
    const user = userEvent.setup()
    renderMemory()

    await user.click(await row('Deposit policy'))
    await user.click(within(screen.getByRole('dialog', { name: 'Deposit policy' })).getByRole('button', { name: 'Edit' }))
    const form = screen.getByRole('dialog', { name: 'Edit entry' })
    await user.type(within(form).getByLabelText('Content'), ' Scrap this.')
    await user.click(within(form).getByRole('button', { name: 'Cancel' }))
    await user.click(
      within(screen.getByRole('dialog', { name: 'Discard your changes?' })).getByRole('button', { name: 'Discard' }),
    )

    const sheet = screen.getByRole('dialog', { name: 'Deposit policy' })
    expect(within(sheet).queryByText(/Scrap this/)).not.toBeInTheDocument()
    expect(within(sheet).getByText(/The deposit comes off the price/)).toBeInTheDocument()
    expect(service.saveHandbookEntry).not.toHaveBeenCalled()

    // Editing again starts from the saved entry, not the discarded draft.
    await user.click(within(sheet).getByRole('button', { name: 'Edit' }))
    expect(within(screen.getByRole('dialog', { name: 'Edit entry' })).getByLabelText('Content')).toHaveValue(
      DEPOSIT_CONTENT,
    )
  })
})

describe('Decisions', () => {
  it('lists decisions with the most recent first', async () => {
    renderMemory('/memory?tab=decisions')
    await row('Close on Mondays')

    const rows = within(screen.getByRole('list', { name: 'Decisions' })).getAllByRole('button')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Let Jarvis book without calling back')
    expect(rows[0]).toHaveTextContent(formatDateOnly('2026-11-05'))
    expect(rows[1]).toHaveTextContent('Close on Mondays')
    expect(rows[1]).toHaveTextContent('Both shops stay closed on Mondays from November.')
  })

  it('opens a decision for reading: when, what, and why', async () => {
    const user = userEvent.setup()
    renderMemory('/memory?tab=decisions')

    await user.click(await row('Close on Mondays'))

    const sheet = screen.getByRole('dialog', { name: 'Close on Mondays' })
    expect(within(sheet).getByText(formatDateOnly('2026-10-20'))).toBeInTheDocument()
    expect(within(sheet).getByRole('heading', { name: 'Decision' })).toBeInTheDocument()
    expect(within(sheet).getByText('Both shops stay closed on Mondays from November.')).toBeInTheDocument()
    expect(within(sheet).getByRole('heading', { name: 'Why' })).toBeInTheDocument()
    expect(within(sheet).getByText(/the barbers asked for a fixed day off/)).toBeInTheDocument()
    expect(within(within(sheet).getByRole('list', { name: 'Tags' })).getByText('hours')).toBeInTheDocument()
    expect(within(sheet).getByText('Synced with Notion')).toBeInTheDocument()
    expect(within(sheet).queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('says when no reason was written down, and when it is not in Notion', async () => {
    const user = userEvent.setup()
    renderMemory('/memory?tab=decisions')

    await user.click(await row('Let Jarvis book'))

    const sheet = screen.getByRole('dialog', { name: 'Let Jarvis book without calling back' })
    expect(within(sheet).getByText('No reason written down yet.')).toBeInTheDocument()
    expect(within(sheet).getByText('Not in Notion yet. Sync comes later.')).toBeInTheDocument()
  })

  it('adds a decision dated today, with the reason left out', async () => {
    const user = userEvent.setup()
    renderMemory('/memory?tab=decisions')
    await row('Close on Mondays')

    await user.click(screen.getByRole('button', { name: 'Add decision' }))
    const sheet = screen.getByRole('dialog', { name: 'New decision' })
    expect(within(sheet).getByLabelText('Decided on')).toHaveValue(localDate())

    await user.click(within(sheet).getByRole('button', { name: 'Save decision' }))

    expect(within(sheet).getByText('Give the decision a title.')).toBeInTheDocument()
    expect(within(sheet).getByText('Write what you decided.')).toBeInTheDocument()
    expect(service.saveDecision).not.toHaveBeenCalled()

    await user.type(within(sheet).getByLabelText('Title'), 'Raise the cut to $38')
    await user.type(within(sheet).getByLabelText('Decision'), 'Standard cut goes to $38 in January.')
    await user.type(within(sheet).getByLabelText('Tags'), 'prices, , 2027')
    await user.click(within(sheet).getByRole('button', { name: 'Save decision' }))

    await waitFor(() =>
      expect(service.saveDecision).toHaveBeenCalledWith({
        title: 'Raise the cut to $38',
        decision: 'Standard cut goes to $38 in January.',
        rationale: null,
        decided_on: localDate(),
        tags: ['prices', '2027'],
      }),
    )
    expect(await screen.findByText('Decision saved')).toBeInTheDocument()
    await expectNoSheet()
  })

  it('edits a decision in place, keeping its id', async () => {
    const user = userEvent.setup()
    renderMemory('/memory?tab=decisions')

    await user.click(await row('Close on Mondays'))
    await user.click(within(screen.getByRole('dialog', { name: 'Close on Mondays' })).getByRole('button', { name: 'Edit' }))

    const form = screen.getByRole('dialog', { name: 'Edit decision' })
    expect(within(form).getByLabelText('Decided on')).toHaveValue('2026-10-20')
    const why = within(form).getByLabelText('Why')
    await user.clear(why)
    await user.type(why, 'Too quiet to open.')
    await user.click(within(form).getByRole('button', { name: 'Save decision' }))

    await waitFor(() =>
      expect(service.saveDecision).toHaveBeenCalledWith({
        id: 'dc-mondays',
        title: 'Close on Mondays',
        decision: 'Both shops stay closed on Mondays from November.',
        rationale: 'Too quiet to open.',
        decided_on: '2026-10-20',
        tags: ['hours'],
      }),
    )
    expect(service.saveDecision.mock.calls[0]?.[0]).not.toHaveProperty('notion_page_id')

    const sheet = await screen.findByRole('dialog', { name: 'Close on Mondays' })
    expect(within(sheet).getByText('Too quiet to open.')).toBeInTheDocument()
    expect(within(sheet).getByText('Saved')).toBeInTheDocument()
    expect(await screen.findByText('Decision saved')).toBeInTheDocument()
  })

  it('asks before deleting a decision', async () => {
    const user = userEvent.setup()
    renderMemory('/memory?tab=decisions')

    await user.click(await row('Close on Mondays'))
    await user.click(within(screen.getByRole('dialog', { name: 'Close on Mondays' })).getByRole('button', { name: 'Edit' }))
    await user.click(
      within(screen.getByRole('dialog', { name: 'Edit decision' })).getByRole('button', { name: 'Delete decision' }),
    )

    const confirm = screen.getByRole('dialog', { name: 'Delete this decision?' })
    expect(service.deleteDecision).not.toHaveBeenCalled()
    await user.click(within(confirm).getByRole('button', { name: 'Delete decision' }))

    await waitFor(() => expect(service.deleteDecision).toHaveBeenCalledWith('dc-mondays'))
    expect(await screen.findByText('Decision deleted')).toBeInTheDocument()
    await expectNoSheet()
  })

  it('keeps the form when saving a decision fails, and asks before discarding it', async () => {
    const user = userEvent.setup()
    service.saveDecision.mockRejectedValue(new Error('The backend did not answer.'))
    renderMemory('/memory?tab=decisions')
    await row('Close on Mondays')

    await user.click(screen.getByRole('button', { name: 'Add decision' }))
    const sheet = screen.getByRole('dialog', { name: 'New decision' })
    await user.type(within(sheet).getByLabelText('Title'), 'Hire a third barber')
    await user.type(within(sheet).getByLabelText('Decision'), 'Start looking in January.')
    await user.click(within(sheet).getByRole('button', { name: 'Save decision' }))

    expect(await within(sheet).findByRole('alert')).toHaveTextContent(
      'Couldn’t save the decision. The backend did not answer.',
    )
    expect(within(sheet).getByLabelText('Decision')).toHaveValue('Start looking in January.')

    await user.click(within(sheet).getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('dialog', { name: 'Discard your changes?' })).toBeInTheDocument()
  })
})

describe('Memory states', () => {
  it('shows placeholders while the handbook loads', () => {
    service.listHandbookEntries.mockReturnValue(new Promise(() => {}))
    renderMemory()

    expect(screen.getByRole('status', { name: 'Loading the handbook' })).toBeInTheDocument()
  })

  it('says what went wrong and loads again on request', async () => {
    const user = userEvent.setup()
    service.listHandbookEntries.mockRejectedValueOnce(new Error('No connection.'))
    renderMemory()

    const problem = await screen.findByRole('alert')
    expect(problem).toHaveTextContent('Couldn’t load the handbook.')
    expect(problem).toHaveTextContent('No connection.')

    await user.click(within(problem).getByRole('button', { name: 'Try again' }))

    expect(await row('Deposit policy')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('invites a first entry when the handbook is empty, even mid-search', async () => {
    const user = userEvent.setup()
    service.listHandbookEntries.mockResolvedValue([])
    renderMemory()

    expect(await screen.findByText('The handbook is empty.')).toBeInTheDocument()
    expect(
      screen.getByText('Add what Jarvis should know: prices, policies, how to answer the phone.'),
    ).toBeInTheDocument()

    await user.type(screen.getByRole('searchbox', { name: 'Search the handbook' }), 'zebra')
    expect(screen.getByText('The handbook is empty.')).toBeInTheDocument()
    expect(screen.queryByText(/Nothing matches/)).not.toBeInTheDocument()
  })

  it('has its own loading, error and empty states for decisions', async () => {
    service.listDecisions.mockRejectedValueOnce(new Error('No connection.'))
    const failed = renderMemory('/memory?tab=decisions')
    expect(screen.getByRole('status', { name: 'Loading decisions' })).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load decisions.')
    failed.unmount()

    service.listDecisions.mockResolvedValue([])
    renderMemory('/memory?tab=decisions')
    expect(await screen.findByText('No decisions logged yet.')).toBeInTheDocument()
    expect(screen.getByText('Write down a decision and why you made it.')).toBeInTheDocument()
  })
})
