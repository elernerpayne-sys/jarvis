import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Button } from '@/components/ui/Button'
import { formatDuration, formatPhone, isWithinQuietHours, titleFromInstructions } from '@/lib/format'
import { filterByQuery } from '@/lib/search'

describe('foundation', () => {
  it('renders a button with its label', () => {
    render(<Button variant="primary">Approve</Button>)
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
  })

  it('blocks presses while loading', () => {
    render(<Button loading>Save entry</Button>)
    expect(screen.getByRole('button', { name: 'Save entry' })).toBeDisabled()
  })
})

describe('format', () => {
  it('formats durations', () => {
    expect(formatDuration(42)).toBe('42s')
    expect(formatDuration(185)).toBe('3m 05s')
    expect(formatDuration(4320)).toBe('1h 12m')
  })

  it('formats US phone numbers and leaves others alone', () => {
    expect(formatPhone('+15125550142')).toBe('(512) 555-0142')
    expect(formatPhone('+442079460000')).toBe('+442079460000')
    expect(formatPhone(null)).toBe('')
  })

  it('shortens long instructions into a title', () => {
    expect(titleFromInstructions('Fix the booking bug\nDetails follow')).toBe('Fix the booking bug')
    expect(titleFromInstructions('   ')).toBe('Untitled task')
    expect(titleFromInstructions('a '.repeat(100)).length).toBeLessThanOrEqual(73)
  })

  it('handles overnight quiet hours', () => {
    const at = (hour: number) => new Date(Date.UTC(2026, 10, 19, hour, 30))
    expect(isWithinQuietHours('22:00', '07:00', 'UTC', at(23))).toBe(true)
    expect(isWithinQuietHours('22:00', '07:00', 'UTC', at(3))).toBe(true)
    expect(isWithinQuietHours('22:00', '07:00', 'UTC', at(12))).toBe(false)
    expect(isWithinQuietHours('09:00', '17:00', 'UTC', at(12))).toBe(true)
    expect(isWithinQuietHours('09:00', '09:00', 'UTC', at(9))).toBe(false)
  })
})

describe('search', () => {
  const items = [
    { title: 'Deposit policy', body: 'Take a $10 deposit for new clients.' },
    { title: 'Opening hours', body: 'Closed Mondays.' },
  ]

  it('matches every word, in any field, ignoring case', () => {
    expect(filterByQuery(items, 'DEPOSIT clients', (i) => [i.title, i.body])).toHaveLength(1)
    expect(filterByQuery(items, 'deposit mondays', (i) => [i.title, i.body])).toHaveLength(0)
    expect(filterByQuery(items, '  ', (i) => [i.title, i.body])).toHaveLength(2)
  })
})
