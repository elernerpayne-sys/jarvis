import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Approval } from '@/lib/types'
import { ApprovalCard } from '@/components/ApprovalCard'
import { ToastProvider } from '@/components/ui/Toast'

const decideApproval = vi.hoisted(() => vi.fn())

vi.mock('@/services', async () => {
  const errors = await vi.importActual<typeof import('@/services/errors')>('@/services/errors')
  return { ...errors, api: { mode: 'demo', decideApproval } }
})

const approval: Approval = {
  id: 'ap-1',
  kind: 'code',
  title: 'Push the booking fix and open a pull request?',
  detail: '3 files changed in booking-site.',
  task_id: 'task-1',
  shop_id: null,
  status: 'pending',
  requested_at: new Date().toISOString(),
  decided_at: null,
  expires_at: null,
  created_at: new Date().toISOString(),
}

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ToastProvider>
          <ApprovalCard approval={approval} />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ApprovalCard', () => {
  beforeEach(() => {
    decideApproval.mockReset()
  })

  it('does nothing until the decision is confirmed', async () => {
    const user = userEvent.setup()
    decideApproval.mockResolvedValue({ ...approval, status: 'approved' })
    renderCard()

    await user.click(screen.getByRole('button', { name: 'Approve' }))
    expect(decideApproval).not.toHaveBeenCalled()

    const dialog = screen.getByRole('dialog', { name: 'Approve this request?' })
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }))

    await waitFor(() => expect(decideApproval).toHaveBeenCalledWith('ap-1', 'approved'))
    expect(await screen.findByText('Approved')).toBeInTheDocument()
  })

  it('lets the owner back out of a denial', async () => {
    const user = userEvent.setup()
    renderCard()

    await user.click(screen.getByRole('button', { name: 'Deny' }))
    const dialog = screen.getByRole('dialog', { name: 'Deny this request?' })
    await user.click(within(dialog).getByRole('button', { name: 'Go back' }))

    expect(decideApproval).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('says what went wrong and keeps the confirm step open', async () => {
    const user = userEvent.setup()
    decideApproval.mockRejectedValue(new Error('The Jarvis backend did not answer.'))
    renderCard()

    await user.click(screen.getByRole('button', { name: 'Deny' }))
    const dialog = screen.getByRole('dialog', { name: 'Deny this request?' })
    await user.click(within(dialog).getByRole('button', { name: 'Deny' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The Jarvis backend did not answer.')
  })
})
