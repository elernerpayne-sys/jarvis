/**
 * Shared by the Code tests: sample rows, and a way to open the Code screens at
 * a path with everything they expect around them.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router'

import type { Approval, Task, TaskEvent } from '@/lib/types'
import { ToastProvider } from '@/components/ui/Toast'
import Code from '@/features/code'

const NOW = Date.now()

/** An ISO timestamp this many minutes in the past. */
export function minutesAgo(minutes: number): string {
  return new Date(NOW - minutes * 60_000).toISOString()
}

export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    external_id: null,
    title: 'Fix the double booking',
    repo: 'acme/booking-site',
    instructions: 'Fix the double booking when two callers pick the same slot.',
    status: 'running',
    branch: null,
    result_summary: null,
    pr_url: null,
    error: null,
    created_at: minutesAgo(30),
    updated_at: minutesAgo(5),
    started_at: minutesAgo(29),
    finished_at: null,
    ...overrides,
  }
}

export function makeEvent(overrides: Partial<TaskEvent> = {}): TaskEvent {
  return {
    id: 'event-1',
    task_id: 'task-1',
    kind: 'log',
    message: 'Reading the booking code',
    created_at: minutesAgo(20),
    ...overrides,
  }
}

export function makeApproval(overrides: Partial<Approval> = {}): Approval {
  return {
    id: 'approval-1',
    kind: 'code',
    title: 'Push the booking fix and open a pull request?',
    detail: '3 files changed in booking-site.',
    task_id: 'task-1',
    shop_id: null,
    status: 'pending',
    requested_at: minutesAgo(2),
    decided_at: null,
    expires_at: null,
    created_at: minutesAgo(2),
    ...overrides,
  }
}

/** Prints where the router is, so a test can tell a redirect from a push. */
function WhereAmI() {
  const { pathname } = useLocation()
  const how = useNavigationType()
  return (
    <p data-testid="location">
      {pathname} {how}
    </p>
  )
}

/** Opens the Code screens at `path`, e.g. "/code", "/code/new", "/code/task-1". */
export function renderCode(path: string) {
  // No waiting between retries: a failed load should show its error at once.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider>
          <Routes>
            <Route path="/code/*" element={<Code />} />
            <Route path="*" element={<p>Another screen</p>} />
          </Routes>
          <WhereAmI />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { ...view, queryClient }
}
