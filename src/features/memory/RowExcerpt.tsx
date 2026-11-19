import { excerpt } from '@/features/memory/excerpt'

/**
 * A row's second line, held to two lines. ListRow's own clamp is undone by
 * the `block` class next to it, so the clamp is applied here instead.
 */
export function RowExcerpt({ text }: { text: string }) {
  return <span className="line-clamp-2">{excerpt(text)}</span>
}
