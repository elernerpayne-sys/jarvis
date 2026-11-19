import type { Decision, HandbookEntry } from '@/lib/types'
import { ServiceError } from '@/services/errors'
import type { JarvisService } from '@/services/types'

import { getClient } from '../client'
import { DECISION_COLUMNS, HANDBOOK_COLUMNS } from '../columns'
import { many, none, one } from '../db'

/** Search runs on the device, so the whole book is loaded; this only caps a runaway table. */
const ENTRY_LIMIT = 500

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Trimmed, without blanks or repeats, in the order they were typed. */
function cleanTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter((tag) => tag !== ''))]
}

function required(value: string, message: string): string {
  const trimmed = value.trim()
  if (trimmed === '') throw new ServiceError('invalid', message)
  return trimmed
}

export const memory: Pick<
  JarvisService,
  | 'listHandbookEntries'
  | 'saveHandbookEntry'
  | 'deleteHandbookEntry'
  | 'listDecisions'
  | 'saveDecision'
  | 'deleteDecision'
> = {
  async listHandbookEntries() {
    return many<HandbookEntry>(
      getClient()
        .from('handbook_entries')
        .select(HANDBOOK_COLUMNS)
        .order('updated_at', { ascending: false })
        .limit(ENTRY_LIMIT),
    )
  },

  async saveHandbookEntry(input) {
    // notion_page_id is never part of this: it belongs to the Notion sync.
    const values = {
      title: required(input.title, 'Give the entry a title.'),
      category: input.category.trim(),
      content: input.content.trim(),
      tags: cleanTags(input.tags),
    }
    const table = getClient().from('handbook_entries')
    const write = input.id === undefined ? table.insert(values) : table.update(values).eq('id', input.id)
    return one<HandbookEntry>(write.select(HANDBOOK_COLUMNS).single(), {
      notFound: 'Couldn’t find that entry. It may have been deleted.',
    })
  },

  async deleteHandbookEntry(id) {
    await none(getClient().from('handbook_entries').delete().eq('id', id), {
      notFound: 'Couldn’t find that entry. It may have been deleted.',
    })
  },

  async listDecisions() {
    return many<Decision>(
      getClient()
        .from('decisions')
        .select(DECISION_COLUMNS)
        .order('decided_on', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(ENTRY_LIMIT),
    )
  },

  async saveDecision(input) {
    const decidedOn = input.decided_on.trim()
    if (!CALENDAR_DATE.test(decidedOn)) throw new ServiceError('invalid', 'Pick the date this was decided.')
    const values = {
      title: required(input.title, 'Give the decision a title.'),
      decision: required(input.decision, 'Write down what was decided.'),
      rationale: input.rationale?.trim() || null,
      decided_on: decidedOn,
      tags: cleanTags(input.tags),
    }
    const table = getClient().from('decisions')
    const write = input.id === undefined ? table.insert(values) : table.update(values).eq('id', input.id)
    return one<Decision>(write.select(DECISION_COLUMNS).single(), {
      notFound: 'Couldn’t find that decision. It may have been deleted.',
    })
  },

  async deleteDecision(id) {
    await none(getClient().from('decisions').delete().eq('id', id), {
      notFound: 'Couldn’t find that decision. It may have been deleted.',
    })
  },
}
