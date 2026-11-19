import { useState } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'

import { cn } from '@/lib/cn'
import { CALL_OUTCOME } from '@/lib/status'
import type { CallFilter, CallSummary } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { Segmented } from '@/components/ui/Form'
import type { SegmentedOption } from '@/components/ui/Form'
import { List, ListRow } from '@/components/ui/List'
import { Section } from '@/components/ui/Page'
import { EmptyState, QueryView, SkeletonRows } from '@/components/ui/States'
import { Dot } from '@/components/ui/StatusDot'
import { callTime, callerLabel } from '@/features/receptionist/lib'
import { useNow } from '@/features/receptionist/useNow'

const FILTERS: ReadonlyArray<SegmentedOption<CallFilter>> = [
  { value: 'all', label: 'All' },
  { value: 'problems', label: 'Missed or failed' },
]

/** A shop's call log can run to hundreds; start with the recent ones. */
const PREVIEW_COUNT = 20

function CallRow({ call, now, onOpen }: { call: CallSummary; now: Date; onOpen: (id: string) => void }) {
  const outcome = CALL_OUTCOME[call.outcome]
  return (
    <ListRow
      onClick={() => onOpen(call.id)}
      leading={
        // Centres the dot on the caller's line.
        <span className="flex h-4 items-center">
          <Dot tone={outcome.tone} />
        </span>
      }
      title={callerLabel(call)}
      // Clamped here: ListRow's own `block` class cancels its `line-clamp-2`.
      subtitle={call.summary ? <span className="line-clamp-2">{call.summary}</span> : undefined}
      trailing={
        <>
          <time dateTime={call.started_at} className="block">
            {callTime(call.started_at, now)}
          </time>
          <span className={cn('block', outcome.tone === 'bad' && 'text-bad')}>{outcome.label}</span>
        </>
      }
    />
  )
}

function CallList({ calls, onOpen }: { calls: CallSummary[]; onOpen: (id: string) => void }) {
  const now = useNow()
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? calls : calls.slice(0, PREVIEW_COUNT)

  return (
    <div className="space-y-3">
      <List>
        {visible.map((call) => (
          <CallRow key={call.id} call={call} now={now} onOpen={onOpen} />
        ))}
      </List>
      {calls.length > PREVIEW_COUNT ? (
        <Button
          variant="ghost"
          className="-ml-4"
          aria-expanded={showAll}
          onClick={() => setShowAll((current) => !current)}
        >
          {showAll ? 'Show fewer' : `Show all ${calls.length}`}
        </Button>
      ) : null}
    </div>
  )
}

/** The shop's call log, newest first, with a filter for the calls that went wrong. */
export function CallsSection({
  query,
  filter,
  onFilterChange,
  onOpenCall,
}: {
  query: UseQueryResult<CallSummary[]>
  filter: CallFilter
  onFilterChange: (filter: CallFilter) => void
  onOpenCall: (id: string) => void
}) {
  return (
    <Section
      title="Calls"
      action={
        <Segmented
          label="Which calls to show"
          value={filter}
          onChange={onFilterChange}
          options={FILTERS}
          // Size each option to its own label: at equal widths the long one is cut off.
          className="[&>button]:flex-none [&>button]:px-3"
        />
      }
    >
      <QueryView
        query={query}
        loading={<SkeletonRows count={4} label="Loading calls" />}
        errorTitle="Couldn’t load calls."
        isEmpty={(calls) => calls.length === 0}
        empty={
          filter === 'problems' ? (
            <EmptyState title="No missed or failed calls." body="Every caller got through." />
          ) : (
            <EmptyState title="No calls yet." body="They show up here as Jarvis answers them." />
          )
        }
      >
        {(calls) => (
          // Keyed so "Show all" starts over when the filter changes.
          <CallList key={filter} calls={calls} onOpen={onOpenCall} />
        )}
      </QueryView>
    </Section>
  )
}
