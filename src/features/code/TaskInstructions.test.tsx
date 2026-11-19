import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { TaskInstructions } from '@/features/code/TaskInstructions'

/** jsdom lays nothing out, so say how tall the text is and how much of it shows. */
function layOut(heights: { text: number; visible: number }) {
  vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(heights.text)
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(heights.visible)
}

describe('TaskInstructions', () => {
  it('shows short instructions as they are', () => {
    layOut({ text: 48, visible: 48 })
    render(<TaskInstructions text="Add a holiday banner." />)

    expect(screen.getByText('Add a holiday banner.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('folds long instructions and opens them on request', async () => {
    const user = userEvent.setup()
    layOut({ text: 240, visible: 96 })
    render(<TaskInstructions text={'Rework the booking flow.\n'.repeat(10)} />)

    const text = screen.getByText(/Rework the booking flow/)
    const showAll = screen.getByRole('button', { name: 'Show all' })
    expect(showAll).toHaveAttribute('aria-expanded', 'false')
    expect(text).toHaveClass('line-clamp-4')

    await user.click(showAll)
    const showLess = screen.getByRole('button', { name: 'Show less' })
    expect(showLess).toHaveAttribute('aria-expanded', 'true')
    expect(text).not.toHaveClass('line-clamp-4')

    await user.click(showLess)
    expect(screen.getByRole('button', { name: 'Show all' })).toBeInTheDocument()
    expect(text).toHaveClass('line-clamp-4')
  })
})
