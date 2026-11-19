import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Task } from '@/lib/types'
import { ServiceError } from '@/services/errors'
import { qk } from '@/services/hooks'
import { makeApproval, makeEvent, makeTask, minutesAgo, renderCode } from '@/features/code/testing'

const api = vi.hoisted(() => ({
  mode: 'demo',
  getTask: vi.fn(),
  listTaskEvents: vi.fn(),
  listApprovals: vi.fn(),
  cancelTask: vi.fn(),
  decideApproval: vi.fn(),
  listTasks: vi.fn(),
}))

vi.mock('@/services', async () => {
  const errors = await vi.importActual<typeof import('@/services/errors')>('@/services/errors')
  return { ...errors, api }
})

/** Opens the detail screen for `task` and waits for it to load. */
async function openTask(task: Task) {
  api.getTask.mockResolvedValue(task)
  renderCode(`/code/${task.id}`)
  await screen.findByRole('heading', { level: 1, name: task.title })
}

const taskStatus = () => screen.getByRole('status', { name: 'Status' })
const cancelButton = () => screen.queryByRole('button', { name: 'Cancel task' })

describe('Code: task detail', () => {
  beforeEach(() => {
    api.getTask.mockReset()
    api.listTaskEvents.mockReset().mockResolvedValue([])
    api.listApprovals.mockReset().mockResolvedValue([])
    api.cancelTask.mockReset()
    api.decideApproval.mockReset()
    api.listTasks.mockReset().mockResolvedValue([])
  })

  it('shows a placeholder while the task loads', () => {
    api.getTask.mockReturnValue(new Promise(() => {}))
    renderCode('/code/task-1')

    expect(screen.getByRole('status', { name: 'Loading task' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Code' })).toHaveAttribute('href', '/code')
  })

  it('shows a running task with its status, repo and a way to cancel', async () => {
    await openTask(makeTask({ status: 'running', repo: 'acme/booking-site' }))

    expect(taskStatus()).toHaveTextContent('Running')
    expect(screen.getByText('acme/booking-site')).toBeInTheDocument()
    expect(await screen.findByText('Jarvis is working…')).toBeInTheDocument()
    expect(screen.getByText('No branch yet')).toBeInTheDocument()
    expect(screen.getByText('Fix the double booking when two callers pick the same slot.')).toBeInTheDocument()
    expect(cancelButton()).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Result' })).not.toBeInTheDocument()
    expect(api.listTaskEvents).toHaveBeenCalledWith('task-1')
  })

  it('says nothing is logged yet for a queued task, which can still be cancelled', async () => {
    await openTask(makeTask({ status: 'queued', started_at: null }))

    expect(await screen.findByText('Nothing logged yet.')).toBeInTheDocument()
    expect(screen.queryByText('Jarvis is working…')).not.toBeInTheDocument()
    expect(cancelButton()).toBeInTheDocument()
  })

  describe('when it needs approval', () => {
    it('puts this task’s request on top with Approve and Deny', async () => {
      api.listApprovals.mockResolvedValue([
        makeApproval({ id: 'mine', task_id: 'task-1', title: 'Push the booking fix and open a pull request?' }),
        makeApproval({ id: 'other', task_id: 'task-2', title: 'Delete the old price table?' }),
      ])
      await openTask(makeTask({ status: 'needs_approval' }))

      expect(await screen.findByText('Push the booking fix and open a pull request?')).toBeInTheDocument()
      expect(screen.queryByText('Delete the old price table?')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument()
      // Already on the task: no link back to it.
      expect(screen.queryByRole('link', { name: 'View the task' })).not.toBeInTheDocument()
      expect(api.listApprovals).toHaveBeenCalledWith({ status: 'pending' })
      expect(cancelButton()).toBeInTheDocument()
    })

    it('approves through the confirm step', async () => {
      const user = userEvent.setup()
      const approval = makeApproval({ id: 'mine' })
      api.listApprovals.mockResolvedValue([approval])
      api.decideApproval.mockResolvedValue({ ...approval, status: 'approved' })
      await openTask(makeTask({ status: 'needs_approval' }))

      await user.click(await screen.findByRole('button', { name: 'Approve' }))
      expect(api.decideApproval).not.toHaveBeenCalled()
      const dialog = screen.getByRole('dialog', { name: 'Approve this request?' })
      await user.click(within(dialog).getByRole('button', { name: 'Approve' }))

      await waitFor(() => expect(api.decideApproval).toHaveBeenCalledWith('mine', 'approved'))
    })

    it('says it is waiting when the request itself is not there', async () => {
      api.listApprovals.mockResolvedValue([makeApproval({ task_id: 'task-2' })])
      await openTask(makeTask({ status: 'needs_approval' }))

      expect(await screen.findByText('Waiting for your approval.')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    })
  })

  it('shows the result, branch and pull request of a finished task', async () => {
    await openTask(
      makeTask({
        status: 'done',
        branch: 'jarvis/fix-double-booking',
        pr_url: 'https://github.com/acme/booking-site/pull/42',
        result_summary: 'Fixed the slot check.\nAdded three tests.',
        finished_at: minutesAgo(5),
      }),
    )

    expect(taskStatus()).toHaveTextContent('Done')
    expect(screen.getByRole('heading', { name: 'Result' })).toBeInTheDocument()
    expect(screen.getByText(/Fixed the slot check\.\s+Added three tests\./)).toBeInTheDocument()
    expect(screen.getByText('jarvis/fix-double-booking')).toBeInTheDocument()

    const pullRequest = screen.getByRole('link', { name: /Open pull request/ })
    expect(pullRequest).toHaveAttribute('href', 'https://github.com/acme/booking-site/pull/42')
    expect(pullRequest).toHaveAttribute('target', '_blank')
    expect(pullRequest.getAttribute('rel')).toContain('noopener')

    expect(cancelButton()).not.toBeInTheDocument()
    expect(screen.queryByText('Jarvis is working…')).not.toBeInTheDocument()
  })

  it('does not link to a pull request address that is not a web page', async () => {
    await openTask(makeTask({ status: 'done', branch: 'jarvis/fix', pr_url: 'javascript:alert(1)' }))

    expect(screen.queryByRole('link', { name: /Open pull request/ })).not.toBeInTheDocument()
  })

  it('copies the branch name', async () => {
    const user = userEvent.setup()
    await openTask(makeTask({ branch: 'jarvis/fix-double-booking' }))

    await user.click(screen.getByRole('button', { name: 'Copy branch name' }))

    expect(await screen.findByText('Copied')).toBeInTheDocument()
    expect(await navigator.clipboard.readText()).toBe('jarvis/fix-double-booking')
  })

  it('says so when the branch name cannot be copied', async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Not allowed'))
    await openTask(makeTask({ branch: 'jarvis/fix-double-booking' }))

    await user.click(screen.getByRole('button', { name: 'Copy branch name' }))

    expect(await screen.findByText(/Couldn’t copy/)).toBeInTheDocument()
  })

  it('explains a failed task, with nothing left to cancel', async () => {
    await openTask(
      makeTask({ status: 'failed', error: 'The tests did not pass after three tries.', finished_at: minutesAgo(5) }),
    )

    expect(taskStatus()).toHaveTextContent('Failed')
    const failure = screen.getByRole('alert')
    expect(failure).toHaveTextContent('This task failed')
    expect(failure).toHaveTextContent('The tests did not pass after three tries.')
    expect(within(failure).queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('No branch was made')).toBeInTheDocument()
    expect(cancelButton()).not.toBeInTheDocument()
  })

  it('notes when a task was cancelled', async () => {
    const finishedAt = minutesAgo(5)
    await openTask(makeTask({ status: 'cancelled', finished_at: finishedAt }))

    expect(taskStatus()).toHaveTextContent('Cancelled')
    const time = document.querySelector(`time[datetime="${finishedAt}"]`)
    expect(time?.parentElement).toHaveTextContent(/^Cancelled .+ at .+\.$/)
    expect(cancelButton()).not.toBeInTheDocument()
  })

  it('renders the progress log oldest first, each kind in its own style', async () => {
    api.listTaskEvents.mockResolvedValue([
      makeEvent({ id: 'e1', kind: 'status', message: 'Started', created_at: '2026-11-19T15:04:00.000Z' }),
      makeEvent({ id: 'e2', kind: 'log', message: 'Reading the booking code' }),
      makeEvent({ id: 'e3', kind: 'command', message: 'npm test' }),
      makeEvent({ id: 'e4', kind: 'error', message: '2 tests failed' }),
    ])
    await openTask(makeTask({ status: 'running' }))

    const log = await screen.findByRole('log', { name: 'Progress log' })
    expect(log).toHaveAttribute('aria-live', 'polite')
    const lines = within(log).getAllByRole('listitem')
    expect(lines.map((line) => line.querySelector('p')?.textContent)).toEqual([
      'Started',
      'Reading the booking code',
      'npm test',
      'Error: 2 tests failed',
    ])
    expect(within(log).getByText('Started')).toHaveClass('font-medium', 'text-bone')
    expect(within(log).getByText('Reading the booking code')).toHaveClass('text-ash')
    expect(within(log).getByText('npm test')).toHaveClass('font-mono')
    expect(within(log).getByText(/2 tests failed/)).toHaveClass('text-bad')
    expect(lines[0].querySelector('time')).toHaveAttribute('datetime', '2026-11-19T15:04:00.000Z')
    // The working line comes after everything logged so far.
    expect(log.lastElementChild).toHaveTextContent('Jarvis is working…')
  })

  it('offers a retry when the progress log fails to load', async () => {
    const user = userEvent.setup()
    api.listTaskEvents.mockRejectedValueOnce(new ServiceError('network', 'Jarvis could not be reached.'))
    await openTask(makeTask({ status: 'done' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Couldn’t load the progress log.')

    api.listTaskEvents.mockResolvedValue([makeEvent({ message: 'Opened a pull request' })])
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Opened a pull request')).toBeInTheDocument()
  })

  describe('cancelling', () => {
    it('does nothing until the owner confirms, and lets them back out', async () => {
      const user = userEvent.setup()
      await openTask(makeTask({ status: 'running' }))

      await user.click(screen.getByRole('button', { name: 'Cancel task' }))
      const dialog = screen.getByRole('dialog', { name: 'Cancel this task?' })
      expect(dialog).toHaveTextContent('Jarvis will stop working on it. Anything not yet pushed is discarded.')
      expect(api.cancelTask).not.toHaveBeenCalled()

      await user.click(within(dialog).getByRole('button', { name: 'Keep running' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(api.cancelTask).not.toHaveBeenCalled()
    })

    it('cancels the task once confirmed', async () => {
      const user = userEvent.setup()
      const task = makeTask({ status: 'running' })
      const cancelled = { ...task, status: 'cancelled' as const, finished_at: new Date().toISOString() }
      api.cancelTask.mockImplementation(async () => {
        // From here on the backend reports the task as cancelled.
        api.getTask.mockResolvedValue(cancelled)
        return cancelled
      })
      await openTask(task)

      await user.click(screen.getByRole('button', { name: 'Cancel task' }))
      const dialog = screen.getByRole('dialog', { name: 'Cancel this task?' })
      await user.click(within(dialog).getByRole('button', { name: 'Cancel task' }))

      expect(await screen.findByText('Task cancelled')).toBeInTheDocument()
      expect(api.cancelTask).toHaveBeenCalledExactlyOnceWith('task-1')
      await waitFor(() => expect(taskStatus()).toHaveTextContent('Cancelled'))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(cancelButton()).not.toBeInTheDocument()
    })

    it('still says "Task cancelled" when the live update arrives before the answer', async () => {
      const user = userEvent.setup()
      const task = makeTask({ status: 'running' })
      const cancelled: Task = { ...task, status: 'cancelled', finished_at: new Date().toISOString() }
      let answer: (task: Task) => void = () => {}
      api.cancelTask.mockReturnValue(new Promise<Task>((resolve) => (answer = resolve)))
      api.getTask.mockResolvedValue(task)
      const { queryClient } = renderCode('/code/task-1')
      await screen.findByRole('heading', { level: 1, name: task.title })

      await user.click(screen.getByRole('button', { name: 'Cancel task' }))
      const dialog = screen.getByRole('dialog', { name: 'Cancel this task?' })
      await user.click(within(dialog).getByRole('button', { name: 'Cancel task' }))

      // Realtime reports the task as cancelled while the request is still out.
      api.getTask.mockResolvedValue(cancelled)
      act(() => {
        queryClient.setQueryData(qk.task('task-1'), cancelled)
      })
      await waitFor(() => expect(taskStatus()).toHaveTextContent('Cancelled'))
      expect(screen.queryByText('Task cancelled')).not.toBeInTheDocument()

      await act(async () => answer(cancelled))
      expect(await screen.findByText('Task cancelled')).toBeInTheDocument()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('gives the reason when cancelling fails and keeps the question open', async () => {
      const user = userEvent.setup()
      api.cancelTask.mockRejectedValue(new ServiceError('network', 'The Jarvis backend did not answer.'))
      await openTask(makeTask({ status: 'running' }))

      await user.click(screen.getByRole('button', { name: 'Cancel task' }))
      const dialog = screen.getByRole('dialog', { name: 'Cancel this task?' })
      await user.click(within(dialog).getByRole('button', { name: 'Cancel task' }))

      expect(await within(dialog).findByRole('alert')).toHaveTextContent(
        'Couldn’t cancel it. The Jarvis backend did not answer.',
      )
      expect(screen.getByRole('dialog', { name: 'Cancel this task?' })).toBeInTheDocument()
      expect(screen.queryByText('Task cancelled')).not.toBeInTheDocument()
    })
  })

  it('says a task does not exist and leads back to the list', async () => {
    api.getTask.mockRejectedValue(new ServiceError('not_found', 'No task with that id.'))
    renderCode('/code/nope')

    expect(await screen.findByText('This task doesn’t exist.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Code' })).toHaveAttribute('href', '/code')
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    expect(api.getTask).toHaveBeenCalledTimes(1)
  })

  it('offers a retry when the task fails to load', async () => {
    const user = userEvent.setup()
    api.getTask.mockRejectedValue(new ServiceError('network', 'Jarvis could not be reached.'))
    renderCode('/code/task-1')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Couldn’t load this task.')
    expect(alert).toHaveTextContent('Jarvis could not be reached.')

    api.getTask.mockResolvedValue(makeTask({ title: 'Fix the double booking' }))
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Fix the double booking' })).toBeInTheDocument()
  })
})
