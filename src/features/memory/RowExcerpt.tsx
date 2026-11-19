import { excerpt } from '@/features/memory/excerpt'

// ListRow truncates the title to one line and its subtitle clamp is undone by
// the `block` class beside it. Memory titles are long and are what the owner
// scans for, so both are held to two lines here instead.

/** A row's title, wrapping onto a second line rather than cut short. */
export function RowTitle({ text }: { text: string }) {
  return <span className="line-clamp-2 whitespace-normal">{text}</span>
}

/** A row's second line: the start of the text, held to two lines. */
export function RowExcerpt({ text }: { text: string }) {
  return <span className="line-clamp-2">{excerpt(text)}</span>
}
