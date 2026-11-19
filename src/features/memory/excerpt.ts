/**
 * The start of a longer text on a single line, for the second line of a row.
 * The row clamps it to two lines; cutting it here as well keeps a whole
 * handbook page out of every row's markup and out of its spoken name.
 */
export function excerpt(text: string, max = 200): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  // Prefer ending on a whole word unless that would throw away most of it.
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}
