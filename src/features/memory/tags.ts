/**
 * Tags are typed on one line, separated by commas, and stored as a list.
 */

/**
 * "a, b ,, c" → ["a", "b", "c"].
 * Blanks are dropped, a leading "#" is ignored, and a tag typed twice
 * (whatever its capitals) is kept once.
 */
export function parseTags(text: string): string[] {
  const seen = new Set<string>()
  const tags: string[] = []
  for (const part of text.split(',')) {
    const tag = part.trim().replace(/^#+\s*/, '')
    const key = tag.toLowerCase()
    if (!tag || seen.has(key)) continue
    seen.add(key)
    tags.push(tag)
  }
  return tags
}

/** ["a", "b"] → "a, b", ready to be edited again. */
export function formatTags(tags: readonly string[]): string {
  return tags.join(', ')
}
