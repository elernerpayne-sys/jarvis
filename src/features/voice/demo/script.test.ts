import { describe, expect, it, vi } from 'vitest'

import {
  DATA_UNAVAILABLE,
  answerQuestion,
  briefingTurns,
  loadAnswerData,
  loadBriefingData,
} from '@/features/voice/demo/script'
import type { AnswerData } from '@/features/voice/demo/script'
import {
  sampleApprovals,
  sampleBrief,
  sampleShops,
  sampleSource,
  sampleTasks,
} from '@/features/voice/testing'

const data: AnswerData = {
  brief: sampleBrief,
  approvals: sampleApprovals,
  tasks: sampleTasks,
  shops: sampleShops,
}

describe('demo briefing', () => {
  it('reads today, pending approvals and tasks through the service', async () => {
    const source = sampleSource()
    await expect(loadBriefingData(source)).resolves.toEqual({
      brief: sampleBrief,
      approvals: sampleApprovals,
      tasks: sampleTasks,
    })
    expect(source.listApprovals).toHaveBeenCalledWith({ status: 'pending' })
  })

  it('gives up quietly when a read fails', async () => {
    const source = sampleSource()
    source.getBrief.mockRejectedValue(new Error('down'))
    await expect(loadBriefingData(source)).resolves.toBeNull()
    await expect(loadAnswerData(source)).resolves.toBeNull()
  })

  it('covers calls and bookings, what was missed, approvals and the running task', () => {
    const [calls, approvals, coding] = briefingTurns(data)
    expect(calls).toContain('14 calls')
    expect(calls).toContain('9 appointments')
    expect(calls).toContain('2 calls were missed')
    expect(approvals).toContain('2 things are waiting for your approval')
    expect(approvals).toContain('Push the booking fix and open a pull request?')
    expect(coding).toContain('Fix the double-booking bug')
    expect(coding).toContain('3 tasks finished today')
  })

  it('says so when there is nothing to report', () => {
    const quiet = briefingTurns({
      brief: { ...sampleBrief, calls_answered: 0, bookings_made: 0, missed_calls: 0, tasks_finished: 0 },
      approvals: [],
      tasks: [],
    })
    expect(quiet[0]).toBe('No calls have come in yet today.')
    expect(quiet[1]).toBe('Nothing is waiting for your approval.')
    expect(quiet[2]).toContain('No coding tasks are in the queue.')
  })

  it('admits it when the data cannot be read', () => {
    expect(briefingTurns(null)).toEqual([DATA_UNAVAILABLE])
  })
})

describe('demo answers', () => {
  it.each([
    ['How many calls today?', '14 calls'],
    ['Did we miss anything?', '2 calls were missed'],
    ['any bookings?', '9 appointments'],
    ['What needs my approval', 'Push the booking fix and open a pull request?'],
    ['how is the coding task going', 'Fix the double-booking bug'],
    ['Give me a summary', '2 things are waiting for your approval'],
  ])('answers "%s" from the data', (question, expected) => {
    expect(answerQuestion(question, data)).toContain(expected)
  })

  it('says where the missed calls were', () => {
    expect(answerQuestion('missed calls', data)).toContain('2 at Fade Factory')
  })

  it('answers about a shop by its name, or a telling part of it', () => {
    expect(answerQuestion('How is Fade Factory doing?', data)).toBe(
      'Fade Factory has had 9 calls today: 6 booked, 2 missed.',
    )
    expect(answerQuestion('and northside?', data)).toContain('Northside Barbers has had 5 calls')
  })

  it('mentions a shop’s next appointment when there is one', () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 19, 9, 0) })
    const next = new Date(2026, 10, 19, 15, 30).toISOString()
    const withNext = { ...data, shops: [{ ...sampleShops[0]!, next_appointment_at: next }] }
    expect(answerQuestion('fade factory', withNext)).toMatch(/ The next appointment is today, \S.*\.$/)
    vi.useRealTimers()
  })

  it('greets, and explains what the demo can answer', () => {
    expect(answerQuestion('Hello', data)).toMatch(/^Hello\. This is the demo/)
    expect(answerQuestion('help', data)).toContain('calls, missed calls, bookings, approvals, coding tasks')
  })

  it('says plainly that it is the demo when it has no answer', () => {
    const answer = answerQuestion('What is the weather in Lisbon?', data)
    expect(answer).toContain('This is the demo')
    expect(answer).toContain('sample data')
  })

  it('does not invent numbers when the data cannot be read', () => {
    expect(answerQuestion('How many calls today?', null)).toBe(DATA_UNAVAILABLE)
    expect(answerQuestion('help', null)).toContain('In the demo I can tell you about')
  })
})
