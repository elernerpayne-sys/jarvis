import { useEffect, useRef } from 'react'

import type { Approval } from '@/lib/types'
import { usePendingApprovals } from '@/services/hooks'
import { ApprovalCard } from '@/components/ApprovalCard'
import { Card } from '@/components/ui/Card'
import { Section } from '@/components/ui/Page'
import { EmptyState, QueryView, Skeleton } from '@/components/ui/States'

/** The service lists newest first; here the longest-waiting request leads. */
function oldestFirst(approvals: readonly Approval[]): Approval[] {
  return [...approvals].sort((a, b) => Date.parse(a.requested_at) - Date.parse(b.requested_at))
}

/**
 * Turns the element into a polite live region once the first load is on
 * screen. Live from the start, it would read the whole list out loud every
 * time Home opens; this way only requests that arrive later are announced.
 */
function useLiveOnceLoaded(loaded: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (loaded) ref.current?.setAttribute('aria-live', 'polite')
  }, [loaded])
  return ref
}

/** Shaped like an approval card: who and when, the question, two buttons. */
function ApprovalSkeleton() {
  return (
    <Card role="status" aria-label="Loading approvals">
      <div className="flex justify-between gap-3">
        <Skeleton className="h-3.5 w-20" />
        <Skeleton className="h-3.5 w-12" />
      </div>
      <Skeleton className="mt-4 h-6 w-4/5" />
      <Skeleton className="mt-3 h-3.5 w-3/5" />
      <div className="mt-5 flex gap-3">
        <Skeleton className="h-13 flex-1 rounded-xl" />
        <Skeleton className="h-13 flex-1 rounded-xl" />
      </div>
    </Card>
  )
}

/** Everything Jarvis is waiting on the owner for, longest wait first. */
export function PendingApprovals() {
  const query = usePendingApprovals()
  const count = query.data?.length ?? 0
  const region = useLiveOnceLoaded(query.data !== undefined)

  return (
    // Only new cards are announced; a relative time ticking over is not news.
    <div ref={region} aria-relevant="additions">
      <Section title="Needs your approval" count={count > 0 ? count : undefined}>
        <QueryView
          query={query}
          loading={<ApprovalSkeleton />}
          errorTitle="Couldn’t load approvals."
          isEmpty={(approvals) => approvals.length === 0}
          empty={<EmptyState title="Nothing is waiting on you." />}
        >
          {(approvals) => (
            <ul className="space-y-3">
              {oldestFirst(approvals).map((approval) => (
                <li key={approval.id}>
                  <ApprovalCard approval={approval} />
                </li>
              ))}
            </ul>
          )}
        </QueryView>
      </Section>
    </div>
  )
}
