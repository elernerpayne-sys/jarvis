/**
 * The Decisions Log: how decisions are ordered, searched, and turned into a
 * form and back.
 */
import { localDate } from '@/lib/format'
import { filterByQuery } from '@/lib/search'
import type { Decision, DecisionInput } from '@/lib/types'
import { formatTags, parseTags } from '@/features/memory/tags'
import type { DraftErrors } from '@/features/memory/types'

/** Most recent decision date first; same-day decisions by latest edit. */
export function sortDecisions(decisions: readonly Decision[]): Decision[] {
  return [...decisions].sort(
    (a, b) =>
      b.decided_on.localeCompare(a.decided_on) ||
      Date.parse(b.updated_at) - Date.parse(a.updated_at),
  )
}

export function searchDecisions(decisions: readonly Decision[], query: string): Decision[] {
  return filterByQuery(decisions, query, (decision) => [
    decision.title,
    decision.decision,
    decision.rationale,
    ...decision.tags,
  ])
}

/** The decision form while typing. Tags are one comma-separated line. */
export interface DecisionDraft {
  title: string
  decision: string
  rationale: string
  /** "YYYY-MM-DD", straight from the date input. */
  decided_on: string
  tags: string
}

/** A new decision starts dated today. */
export function toDecisionDraft(decision: Decision | null): DecisionDraft {
  return {
    title: decision?.title ?? '',
    decision: decision?.decision ?? '',
    rationale: decision?.rationale ?? '',
    decided_on: decision?.decided_on ?? localDate(),
    tags: formatTags(decision?.tags ?? []),
  }
}

export function validateDecisionDraft(draft: DecisionDraft): DraftErrors<DecisionDraft> {
  const errors: DraftErrors<DecisionDraft> = {}
  if (!draft.title.trim()) errors.title = 'Give the decision a title.'
  if (!draft.decision.trim()) errors.decision = 'Write what you decided.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.decided_on)) errors.decided_on = 'Pick the date you decided.'
  return errors
}

/** Pass the id to update a decision; leave it out to add a new one. */
export function toDecisionInput(draft: DecisionDraft, id?: string): DecisionInput {
  return {
    ...(id ? { id } : {}),
    title: draft.title.trim(),
    decision: draft.decision.trim(),
    rationale: draft.rationale.trim() || null,
    decided_on: draft.decided_on,
    tags: parseTags(draft.tags),
  }
}
