import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { TaskEvent } from '@/lib/types'
import { TaskLog } from '@/features/code/TaskLog'

function lines(count: number): TaskEvent[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `event-${index + 1}`,
    task_id: 'task-1',
    kind: 'log',
    message: `Step ${index + 1}`,
    created_at: new Date(Date.UTC(2026, 10, 19, 15, index)).toISOString(),
  }))
}

/** jsdom lays nothing out, so say how tall the log and its content are. */
function setHeights(box: HTMLElement, heights: { content: number; visible: number }) {
  Object.defineProperty(box, 'scrollHeight', { configurable: true, value: heights.content })
  Object.defineProperty(box, 'clientHeight', { configurable: true, value: heights.visible })
}

describe('TaskLog', () => {
  it('follows new lines while the owner is at the bottom', () => {
    const view = render(<TaskLog events={lines(3)} working />)
    const log = screen.getByRole('log')

    setHeights(log, { content: 500, visible: 200 })
    view.rerender(<TaskLog events={lines(4)} working />)

    expect(screen.getByText('Step 4')).toBeInTheDocument()
    expect(log.scrollTop).toBe(500)
  })

  it('stays put once the owner has scrolled up, and follows again from the bottom', () => {
    const view = render(<TaskLog events={lines(3)} working />)
    const log = screen.getByRole('log')
    setHeights(log, { content: 500, visible: 200 })

    // Scrolled up to read an earlier line.
    log.scrollTop = 100
    fireEvent.scroll(log)
    setHeights(log, { content: 540, visible: 200 })
    view.rerender(<TaskLog events={lines(4)} working />)
    expect(log.scrollTop).toBe(100)

    // Back at the newest line.
    log.scrollTop = 340
    fireEvent.scroll(log)
    setHeights(log, { content: 580, visible: 200 })
    view.rerender(<TaskLog events={lines(5)} working />)
    expect(log.scrollTop).toBe(580)
  })

  it('drops the working line when Jarvis stops', () => {
    const view = render(<TaskLog events={lines(2)} working />)
    expect(screen.getByText('Jarvis is working…')).toBeInTheDocument()

    view.rerender(<TaskLog events={lines(2)} working={false} />)
    expect(screen.queryByText('Jarvis is working…')).not.toBeInTheDocument()
  })
})
