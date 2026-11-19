import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ServiceError } from '@/services/errors'
import { makeTask, minutesAgo, renderCode } from '@/features/code/testing'

const listTasks = vi.hoisted(() => vi.fn())

vi.mock('@/services', async () => {
  const errors = await vi.importActual<typeof import('@/services/errors')>('@/services/errors')
  return { ...errors, api: { mode: 'demo', listTasks } }
})

/** Where each row in a section leads, top to bottom. */
function rowsIn(section: string): Array<string | null> {
  const list = screen.getByRole('list', { name: section })
  return within(list)
    .getAllByRole('link')
    .map((link) => link.getAttribute('href'))
}

describe('Code: task list', () => {
  beforeEach(() => {
    listTasks.mockReset()
  })

  it('shows a placeholder while tasks load', () => {
    listTasks.mockReturnValue(new Promise(() => {}))
    renderCode('/code')

    expect(screen.getByRole('heading', { level: 1, name: 'Code' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Loading tasks' })).toBeInTheDocument()
  })

  it('splits tasks into in progress and finished, each newest first', async () => {
    listTasks.mockResolvedValue([
      makeTask({ id: 'done-old', title: 'Add a holiday banner', status: 'done', updated_at: minutesAgo(600) }),
      makeTask({ id: 'run', title: 'Fix the double booking', status: 'running', updated_at: minutesAgo(10) }),
      makeTask({ id: 'failed', title: 'Upgrade the payment library', status: 'failed', updated_at: minutesAgo(45) }),
      makeTask({ id: 'approve', title: 'Tidy the price list', status: 'needs_approval', updated_at: minutesAgo(30) }),
      makeTask({ id: 'cancelled', title: 'Rename the shops table', status: 'cancelled', updated_at: minutesAgo(90) }),
      makeTask({ id: 'queued', title: 'Write the weekly report', status: 'queued', updated_at: minutesAgo(2) }),
    ])
    renderCode('/code')

    expect(await screen.findByRole('heading', { name: 'In progress' })).toBeInTheDocument()
    expect(rowsIn('In progress')).toEqual(['/code/queued', '/code/run', '/code/approve'])
    expect(screen.getByRole('heading', { name: 'Finished' })).toBeInTheDocument()
    expect(rowsIn('Finished')).toEqual(['/code/failed', '/code/cancelled', '/code/done-old'])
  })

  it('shows each task with its repo, status and time, linked to the task', async () => {
    listTasks.mockResolvedValue([
      makeTask({ id: 'run', title: 'Fix the double booking', repo: 'acme/booking-site', updated_at: minutesAgo(10) }),
    ])
    renderCode('/code')

    const row = await screen.findByRole('link', { name: /Fix the double booking/ })
    expect(row).toHaveAttribute('href', '/code/run')
    expect(within(row).getByText('acme/booking-site')).toBeInTheDocument()
    expect(within(row).getByText('Running')).toBeInTheDocument()
    expect(within(row).getByText('10m ago')).toBeInTheDocument()
  })

  it('leaves out a section that has nothing in it', async () => {
    listTasks.mockResolvedValue([makeTask({ status: 'done' })])
    renderCode('/code')

    expect(await screen.findByRole('heading', { name: 'Finished' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'In progress' })).not.toBeInTheDocument()
  })

  it('offers a new task from the header', async () => {
    listTasks.mockResolvedValue([makeTask()])
    renderCode('/code')

    await screen.findByRole('heading', { name: 'In progress' })
    expect(screen.getByRole('link', { name: 'New task' })).toHaveAttribute('href', '/code/new')
  })

  it('invites the first task when there are none', async () => {
    listTasks.mockResolvedValue([])
    renderCode('/code')

    expect(await screen.findByText('No tasks yet.')).toBeInTheDocument()
    expect(screen.getByText('Start one and Jarvis will get to work.')).toBeInTheDocument()
    // One way in, not two.
    expect(screen.getByRole('link', { name: 'New task' })).toHaveAttribute('href', '/code/new')
  })

  it('says what went wrong and loads again on retry', async () => {
    const user = userEvent.setup()
    listTasks.mockRejectedValueOnce(new ServiceError('network', 'Jarvis could not be reached.'))
    renderCode('/code')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Couldn’t load tasks.')
    expect(alert).toHaveTextContent('Jarvis could not be reached.')

    listTasks.mockResolvedValue([makeTask({ title: 'Fix the double booking' })])
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('link', { name: /Fix the double booking/ })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
