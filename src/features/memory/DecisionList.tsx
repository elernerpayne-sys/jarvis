import { formatDateOnly } from '@/lib/format'
import type { Decision } from '@/lib/types'
import { List, ListRow } from '@/components/ui/List'
import { sortDecisions } from '@/features/memory/decisions'
import { RowExcerpt } from '@/features/memory/RowExcerpt'

/** The decisions log: one list, most recent decision first. */
export function DecisionList({
  decisions,
  onOpen,
}: {
  decisions: readonly Decision[]
  onOpen: (decision: Decision) => void
}) {
  return (
    <List label="Decisions">
      {sortDecisions(decisions).map((decision) => (
        <ListRow
          key={decision.id}
          onClick={() => onOpen(decision)}
          title={decision.title}
          subtitle={<RowExcerpt text={decision.decision} />}
          trailing={<time dateTime={decision.decided_on}>{formatDateOnly(decision.decided_on)}</time>}
        />
      ))}
    </List>
  )
}
