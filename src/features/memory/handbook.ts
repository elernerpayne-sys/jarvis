/**
 * The Business Handbook: how entries are grouped, searched, and turned into
 * a form and back.
 */
import { filterByQuery } from '@/lib/search'
import type { HandbookEntry, HandbookEntryInput } from '@/lib/types'
import { formatTags, parseTags } from '@/features/memory/tags'
import type { DraftErrors } from '@/features/memory/types'

/** The heading for entries saved without a category. */
export const NO_CATEGORY = 'Other'

export interface CategoryGroup {
  /** As the owner wrote it. Empty for entries without a category. */
  category: string
  /** Most recently updated first. */
  entries: HandbookEntry[]
}

function byUpdatedDesc(a: HandbookEntry, b: HandbookEntry): number {
  return Date.parse(b.updated_at) - Date.parse(a.updated_at)
}

/**
 * Entries under their category, categories A–Z, entries without one last.
 * "Pricing" and "pricing" are the same category.
 */
export function groupByCategory(entries: readonly HandbookEntry[]): CategoryGroup[] {
  const groups = new Map<string, CategoryGroup>()
  for (const entry of [...entries].sort(byUpdatedDesc)) {
    const category = entry.category.trim()
    const key = category.toLowerCase()
    const group = groups.get(key)
    if (group) group.entries.push(entry)
    else groups.set(key, { category, entries: [entry] })
  }
  return [...groups.values()].sort((a, b) => {
    if (!a.category || !b.category) return a.category ? -1 : b.category ? 1 : 0
    return a.category.localeCompare(b.category, undefined, { sensitivity: 'base' })
  })
}

/** Every category in use, A–Z: the suggestions offered while typing one. */
export function categoriesOf(entries: readonly HandbookEntry[]): string[] {
  return groupByCategory(entries)
    .map((group) => group.category)
    .filter(Boolean)
}

export function searchHandbook(entries: readonly HandbookEntry[], query: string): HandbookEntry[] {
  return filterByQuery(entries, query, (entry) => [
    entry.title,
    entry.category,
    entry.content,
    ...entry.tags,
  ])
}

/** The entry form while typing. Tags are one comma-separated line. */
export interface HandbookDraft {
  title: string
  category: string
  content: string
  tags: string
}

export function toHandbookDraft(entry: HandbookEntry | null): HandbookDraft {
  return {
    title: entry?.title ?? '',
    category: entry?.category ?? '',
    content: entry?.content ?? '',
    tags: formatTags(entry?.tags ?? []),
  }
}

export function validateHandbookDraft(draft: HandbookDraft): DraftErrors<HandbookDraft> {
  const errors: DraftErrors<HandbookDraft> = {}
  if (!draft.title.trim()) errors.title = 'Give the entry a title.'
  if (!draft.content.trim()) errors.content = 'Write what Jarvis should know.'
  return errors
}

/** Pass the id to update an entry; leave it out to add a new one. */
export function toHandbookInput(draft: HandbookDraft, id?: string): HandbookEntryInput {
  return {
    ...(id ? { id } : {}),
    title: draft.title.trim(),
    category: draft.category.trim(),
    content: draft.content.trim(),
    tags: parseTags(draft.tags),
  }
}
