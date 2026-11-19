import { describe, expect, it } from 'vitest'

import { callTime, callerLabel, groupByDay, noTranscriptCopy, telHref, todaySentence } from '@/features/receptionist/lib'
import { NOW, at, makeShop } from '@/features/receptionist/testing/fixtures'

describe('todaySentence', () => {
  it('adds up every shop and mentions missed calls', () => {
    const shops = [
      makeShop({ calls_today: 12, missed_today: 2 }),
      makeShop({ id: 'shop-2', calls_today: 9, missed_today: 1 }),
      makeShop({ id: 'shop-3', calls_today: 5, missed_today: 0 }),
    ]
    expect(todaySentence(shops)).toBe('26 calls today across 3 shops, 3 missed.')
  })

  it('drops the missed clause when nothing was missed', () => {
    const shops = [makeShop({ calls_today: 4, missed_today: 0 }), makeShop({ id: 'shop-2', calls_today: 2, missed_today: 0 })]
    expect(todaySentence(shops)).toBe('6 calls today across 2 shops.')
  })

  it('does not count shops when there is only one', () => {
    expect(todaySentence([makeShop({ calls_today: 1, missed_today: 1 })])).toBe('1 call today, 1 missed.')
  })

  it('has something to say on a quiet morning', () => {
    expect(todaySentence([makeShop({ calls_today: 0, missed_today: 0 })])).toBe('No calls yet today.')
  })
})

describe('callerLabel', () => {
  it('uses the name when there is one', () => {
    expect(callerLabel({ caller_name: 'Devon Hill', caller_phone: '+15125550111' })).toBe('Devon Hill')
  })

  it('falls back to the formatted number', () => {
    expect(callerLabel({ caller_name: null, caller_phone: '+15125550111' })).toBe('(512) 555-0111')
    expect(callerLabel({ caller_name: '  ', caller_phone: '+15125550111' })).toBe('(512) 555-0111')
  })

  it('admits it when the number was withheld too', () => {
    expect(callerLabel({ caller_name: null, caller_phone: '' })).toBe('Unknown caller')
  })
})

describe('callTime', () => {
  it('says how long ago for today’s calls', () => {
    expect(callTime(at(0, 9, 40), NOW)).toBe('20m ago')
    expect(callTime(at(0, 7), NOW)).toBe('3h ago')
  })

  it('names the day for anything older, however recent', () => {
    // 11:30 last night is under twelve hours ago, but it was yesterday's call.
    expect(callTime(at(-1, 23, 30), NOW)).toBe('Yesterday')
    // Further back it is a date, never "168h ago".
    expect(callTime(at(-7, 15), NOW)).not.toMatch(/ago/)
  })
})

describe('telHref', () => {
  it('keeps only what a phone can dial', () => {
    expect(telHref('+15125550111')).toBe('tel:+15125550111')
    expect(telHref('(512) 555-0111')).toBe('tel:5125550111')
  })
})

describe('groupByDay', () => {
  it('splits by local calendar day and keeps the order', () => {
    const items = [
      { id: 'a', starts_at: at(0, 9) },
      { id: 'b', starts_at: at(0, 23, 30) },
      { id: 'c', starts_at: at(1, 0, 15) },
      { id: 'd', starts_at: at(3, 12) },
    ]
    const groups = groupByDay(items, (item) => item.starts_at)

    expect(groups.map((group) => group.day)).toEqual(['2026-11-19', '2026-11-20', '2026-11-22'])
    expect(groups.map((group) => group.items.map((item) => item.id))).toEqual([['a', 'b'], ['c'], ['d']])
    expect(groups[1]?.at).toBe(items[2]?.starts_at)
  })

  it('returns nothing for nothing', () => {
    expect(groupByDay([], () => at(0, 9))).toEqual([])
  })
})

describe('noTranscriptCopy', () => {
  it('explains a missed call', () => {
    expect(noTranscriptCopy('missed')).toBe('No conversation. The caller hung up before Jarvis could answer.')
  })

  it('does not blame the caller for other outcomes', () => {
    expect(noTranscriptCopy('failed')).toMatch(/dropped/)
    expect(noTranscriptCopy('answered')).toBe('No transcript for this call yet.')
  })
})
