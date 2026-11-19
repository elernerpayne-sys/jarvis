import { describe, expect, it } from 'vitest'

import { localDate } from '@/lib/format'
import type { Decision, HandbookEntry } from '@/lib/types'
import {
  searchDecisions,
  sortDecisions,
  toDecisionDraft,
  toDecisionInput,
  validateDecisionDraft,
} from '@/features/memory/decisions'
import { excerpt } from '@/features/memory/excerpt'
import {
  categoriesOf,
  groupByCategory,
  searchHandbook,
  toHandbookDraft,
  toHandbookInput,
  validateHandbookDraft,
} from '@/features/memory/handbook'
import { formatTags, parseTags } from '@/features/memory/tags'

function entry(patch: Partial<HandbookEntry> & Pick<HandbookEntry, 'id'>): HandbookEntry {
  return {
    title: `Entry ${patch.id}`,
    category: 'Pricing',
    content: 'Some content.',
    tags: [],
    notion_page_id: null,
    created_at: '2026-11-01T10:00:00.000Z',
    updated_at: '2026-11-01T10:00:00.000Z',
    ...patch,
  }
}

function decision(patch: Partial<Decision> & Pick<Decision, 'id'>): Decision {
  return {
    title: `Decision ${patch.id}`,
    decision: 'We decided something.',
    rationale: null,
    decided_on: '2026-11-01',
    tags: [],
    notion_page_id: null,
    created_at: '2026-11-01T10:00:00.000Z',
    updated_at: '2026-11-01T10:00:00.000Z',
    ...patch,
  }
}

describe('tags', () => {
  it('splits on commas and drops the blanks', () => {
    expect(parseTags('a, b ,, c')).toEqual(['a', 'b', 'c'])
    expect(parseTags('  ')).toEqual([])
    expect(parseTags(',')).toEqual([])
  })

  it('keeps a repeated tag once and ignores a leading #', () => {
    expect(parseTags('Deposits, deposits, #pricing, new clients')).toEqual([
      'Deposits',
      'pricing',
      'new clients',
    ])
  })

  it('writes tags back as one editable line', () => {
    expect(formatTags(['a', 'b'])).toBe('a, b')
    expect(parseTags(formatTags(['walk-ins', 'no-shows']))).toEqual(['walk-ins', 'no-shows'])
  })
})

describe('excerpt', () => {
  it('puts short text on one line', () => {
    expect(excerpt('Cut: $35.\n\nBeard trim:   $15.')).toBe('Cut: $35. Beard trim: $15.')
  })

  it('cuts long text at a word and marks the cut', () => {
    const cut = excerpt('word '.repeat(100), 50)
    expect(cut.length).toBeLessThanOrEqual(51)
    expect(cut.endsWith('word…')).toBe(true)
  })
})

describe('handbook', () => {
  const entries = [
    entry({ id: 'old-price', category: 'Pricing', updated_at: '2026-11-02T10:00:00.000Z' }),
    entry({ id: 'script', category: 'Phone scripts' }),
    entry({ id: 'loose', category: '  ' }),
    entry({ id: 'new-price', category: 'pricing', updated_at: '2026-11-09T10:00:00.000Z' }),
    entry({ id: 'policy', category: 'Policies' }),
  ]

  it('groups by category A–Z with the newest entry first', () => {
    const groups = groupByCategory(entries)
    expect(groups.map((group) => group.category)).toEqual(['Phone scripts', 'Policies', 'pricing', ''])
    expect(groups[2]?.entries.map((item) => item.id)).toEqual(['new-price', 'old-price'])
  })

  it('offers the categories in use, without the blank one', () => {
    expect(categoriesOf(entries)).toEqual(['Phone scripts', 'Policies', 'pricing'])
  })

  it('searches the title, category, content and tags', () => {
    const all = [
      entry({ id: 'a', title: 'Deposit policy', category: 'Policies' }),
      entry({ id: 'b', content: 'Closed on Mondays.' }),
      entry({ id: 'c', tags: ['walk-ins'] }),
    ]
    expect(searchHandbook(all, 'deposit').map((item) => item.id)).toEqual(['a'])
    expect(searchHandbook(all, 'policies').map((item) => item.id)).toEqual(['a'])
    expect(searchHandbook(all, 'mondays').map((item) => item.id)).toEqual(['b'])
    expect(searchHandbook(all, 'walk-ins').map((item) => item.id)).toEqual(['c'])
    expect(searchHandbook(all, '')).toHaveLength(3)
  })

  it('needs a title and content', () => {
    expect(validateHandbookDraft(toHandbookDraft(null))).toEqual({
      title: 'Give the entry a title.',
      content: 'Write what Jarvis should know.',
    })
    expect(validateHandbookDraft({ title: 'Hours', category: '', content: 'Closed Mondays.', tags: '' })).toEqual({})
  })

  it('tidies what was typed and keeps the id only when there is one', () => {
    const draft = { title: ' Hours ', category: ' Policies ', content: 'Closed Mondays.\n', tags: 'hours, ' }
    expect(toHandbookInput(draft)).toEqual({
      title: 'Hours',
      category: 'Policies',
      content: 'Closed Mondays.',
      tags: ['hours'],
    })
    expect(toHandbookInput(draft, 'hb-1')).toMatchObject({ id: 'hb-1' })
    expect(toHandbookInput(draft)).not.toHaveProperty('id')
  })
})

describe('decisions', () => {
  it('puts the most recent decision first', () => {
    const sorted = sortDecisions([
      decision({ id: 'spring', decided_on: '2026-04-02' }),
      decision({ id: 'autumn', decided_on: '2026-10-20' }),
      decision({ id: 'autumn-later', decided_on: '2026-10-20', updated_at: '2026-11-05T10:00:00.000Z' }),
    ])
    expect(sorted.map((item) => item.id)).toEqual(['autumn-later', 'autumn', 'spring'])
  })

  it('searches the title, decision, reason and tags', () => {
    const all = [
      decision({ id: 'a', title: 'Close on Mondays' }),
      decision({ id: 'b', rationale: 'Twilio was cheaper.' }),
      decision({ id: 'c', tags: ['hiring'] }),
    ]
    expect(searchDecisions(all, 'mondays').map((item) => item.id)).toEqual(['a'])
    expect(searchDecisions(all, 'twilio').map((item) => item.id)).toEqual(['b'])
    expect(searchDecisions(all, 'hiring').map((item) => item.id)).toEqual(['c'])
  })

  it('starts a new decision dated today', () => {
    expect(toDecisionDraft(null).decided_on).toBe(localDate())
  })

  it('needs a title, the decision and a date, but not a reason', () => {
    expect(validateDecisionDraft({ title: '', decision: ' ', rationale: '', decided_on: '', tags: '' })).toEqual({
      title: 'Give the decision a title.',
      decision: 'Write what you decided.',
      decided_on: 'Pick the date you decided.',
    })
    expect(
      validateDecisionDraft({ title: 'Mondays', decision: 'Closed.', rationale: '', decided_on: '2026-11-02', tags: '' }),
    ).toEqual({})
  })

  it('saves an empty reason as none', () => {
    const draft = { title: 'Mondays', decision: 'Closed.', rationale: '  ', decided_on: '2026-11-02', tags: 'hours' }
    expect(toDecisionInput(draft, 'dc-1')).toEqual({
      id: 'dc-1',
      title: 'Mondays',
      decision: 'Closed.',
      rationale: null,
      decided_on: '2026-11-02',
      tags: ['hours'],
    })
  })
})
