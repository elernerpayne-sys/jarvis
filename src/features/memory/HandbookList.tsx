import { useId } from 'react'

import { formatRelative } from '@/lib/format'
import type { HandbookEntry } from '@/lib/types'
import { List, ListRow } from '@/components/ui/List'
import { excerpt } from '@/features/memory/excerpt'
import { NO_CATEGORY, groupByCategory } from '@/features/memory/handbook'
import type { CategoryGroup } from '@/features/memory/handbook'

function CategorySection({
  group,
  onOpen,
}: {
  group: CategoryGroup
  onOpen: (entry: HandbookEntry) => void
}) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="mb-2 text-sm text-ash">
        {group.category || NO_CATEGORY}
      </h2>
      <List>
        {group.entries.map((entry) => (
          <ListRow
            key={entry.id}
            onClick={() => onOpen(entry)}
            title={entry.title}
            subtitle={excerpt(entry.content)}
            trailing={<time dateTime={entry.updated_at}>{formatRelative(entry.updated_at)}</time>}
          />
        ))}
      </List>
    </section>
  )
}

/** The handbook: entries under their category, categories A–Z. */
export function HandbookList({
  entries,
  onOpen,
}: {
  entries: readonly HandbookEntry[]
  onOpen: (entry: HandbookEntry) => void
}) {
  return (
    <div className="space-y-8">
      {groupByCategory(entries).map((group) => (
        <CategorySection key={group.category} group={group} onOpen={onOpen} />
      ))}
    </div>
  )
}
