/**
 * Client-side search for the Memory screen. The handbook and decisions log
 * are small (hundreds of entries at most), so filtering in memory is instant
 * and behaves the same in demo and live mode.
 */

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

/** Splits a query into lowercase words; quotes are not special. */
export function searchTerms(query: string): string[] {
  return normalize(query).split(/\s+/).filter(Boolean)
}

/**
 * True when every word in `query` appears somewhere in `fields`.
 * An empty query matches everything.
 */
export function matchesQuery(
  query: string,
  fields: ReadonlyArray<string | null | undefined>,
): boolean {
  const terms = searchTerms(query)
  if (terms.length === 0) return true
  const haystack = normalize(fields.filter(Boolean).join('\n'))
  return terms.every((term) => haystack.includes(term))
}

/** Keeps the items whose fields match the query, in their original order. */
export function filterByQuery<T>(
  items: readonly T[],
  query: string,
  fieldsOf: (item: T) => ReadonlyArray<string | null | undefined>,
): T[] {
  if (searchTerms(query).length === 0) return [...items]
  return items.filter((item) => matchesQuery(query, fieldsOf(item)))
}
