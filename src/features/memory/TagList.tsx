import { Tag } from '@/components/ui/Page'

/** A row of tags as quiet labels. Renders nothing when there are none. */
export function TagList({ tags, label }: { tags: readonly string[]; label: string }) {
  if (tags.length === 0) return null
  return (
    <ul aria-label={label} className="flex flex-wrap gap-2">
      {tags.map((tag) => (
        <li key={tag} className="flex">
          <Tag>{tag}</Tag>
        </li>
      ))}
    </ul>
  )
}
