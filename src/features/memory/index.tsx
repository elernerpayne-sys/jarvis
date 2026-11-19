import { useState } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import { BookOpen, Plus, Signpost } from 'lucide-react'
import { useSearchParams } from 'react-router'

import type { Decision, HandbookEntry } from '@/lib/types'
import { useDecisions, useHandbook } from '@/services/hooks'
import { Button } from '@/components/ui/Button'
import { SearchField, Segmented } from '@/components/ui/Form'
import type { SegmentedOption } from '@/components/ui/Form'
import { Page } from '@/components/ui/Page'
import { EmptyState, QueryView, Skeleton, SkeletonRows } from '@/components/ui/States'
import { DecisionList } from '@/features/memory/DecisionList'
import { DecisionSheet } from '@/features/memory/DecisionSheet'
import { HandbookList } from '@/features/memory/HandbookList'
import { HandbookSheet } from '@/features/memory/HandbookSheet'
import { SearchResults } from '@/features/memory/SearchResults'
import { searchDecisions } from '@/features/memory/decisions'
import { categoriesOf, searchHandbook } from '@/features/memory/handbook'

type Tab = 'handbook' | 'decisions'

const TAB_OPTIONS: ReadonlyArray<SegmentedOption<Tab>> = [
  { value: 'handbook', label: 'Handbook' },
  { value: 'decisions', label: 'Decisions' },
]

const TAB_COPY: Record<Tab, { add: string; search: string }> = {
  handbook: { add: 'Add entry', search: 'Search the handbook' },
  decisions: { add: 'Add decision', search: 'Search decisions' },
}

/** The tab lives in the URL: /memory is the handbook, ?tab=decisions the log. */
function useTab(): [Tab, (tab: Tab) => void] {
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'decisions' ? 'decisions' : 'handbook'

  function setTab(next: Tab) {
    setParams(
      (current) => {
        const updated = new URLSearchParams(current)
        if (next === 'handbook') updated.delete('tab')
        else updated.set('tab', next)
        return updated
      },
      // Switching tabs is not a step the back button should retrace.
      { replace: true },
    )
  }

  return [tab, setTab]
}

/** What the sheet is showing. A null item means a new one is being written. */
type SheetTarget =
  | { kind: 'handbook'; entry: HandbookEntry | null }
  | { kind: 'decision'; decision: Decision | null }

/**
 * `session` goes up on every open and keys the sheets, so each opening starts
 * clean. It does not change on close: the sheet that just closed stays
 * mounted, which lets the dialog hand focus back to where it came from.
 */
function useSheet() {
  const [state, setState] = useState<{ session: number; target: SheetTarget | null }>({
    session: 0,
    target: null,
  })
  return {
    ...state,
    open: (target: SheetTarget) => setState(({ session }) => ({ session: session + 1, target })),
    close: () => setState(({ session }) => ({ session, target: null })),
  }
}

function HandbookTab({
  handbook,
  search,
  onClearSearch,
  onOpen,
}: {
  handbook: UseQueryResult<HandbookEntry[]>
  search: string
  onClearSearch: () => void
  onOpen: (entry: HandbookEntry) => void
}) {
  return (
    <QueryView
      query={handbook}
      errorTitle="Couldn’t load the handbook."
      loading={
        <div>
          <Skeleton className="mb-3 h-4 w-20" />
          <SkeletonRows count={5} label="Loading the handbook" />
        </div>
      }
      isEmpty={(entries) => entries.length === 0}
      empty={
        <EmptyState
          icon={<BookOpen aria-hidden />}
          title="The handbook is empty."
          body="Add what Jarvis should know: prices, policies, how to answer the phone."
        />
      }
    >
      {(entries) => {
        const matches = searchHandbook(entries, search)
        return (
          <SearchResults
            search={search}
            count={matches.length}
            singular="entry"
            pluralForm="entries"
            onClear={onClearSearch}
          >
            <HandbookList entries={matches} onOpen={onOpen} />
          </SearchResults>
        )
      }}
    </QueryView>
  )
}

function DecisionsTab({
  decisions,
  search,
  onClearSearch,
  onOpen,
}: {
  decisions: UseQueryResult<Decision[]>
  search: string
  onClearSearch: () => void
  onOpen: (decision: Decision) => void
}) {
  return (
    <QueryView
      query={decisions}
      errorTitle="Couldn’t load decisions."
      loading={<SkeletonRows count={5} label="Loading decisions" />}
      isEmpty={(all) => all.length === 0}
      empty={
        <EmptyState
          icon={<Signpost aria-hidden />}
          title="No decisions logged yet."
          body="Write down a decision and why you made it."
        />
      }
    >
      {(all) => {
        const matches = searchDecisions(all, search)
        return (
          <SearchResults
            search={search}
            count={matches.length}
            singular="decision"
            pluralForm="decisions"
            onClear={onClearSearch}
          >
            <DecisionList decisions={matches} onOpen={onOpen} />
          </SearchResults>
        )
      }}
    </QueryView>
  )
}

/**
 * Memory: the Business Handbook (what Jarvis knows) and the Decisions Log
 * (why things are the way they are). Read, search, add and edit both.
 */
export default function Memory() {
  const [tab, setTab] = useTab()
  // One search box for both tabs: the same words are often worth trying in each.
  const [search, setSearch] = useState('')
  const handbook = useHandbook()
  const decisions = useDecisions()
  const sheet = useSheet()
  const { target } = sheet

  function addNew() {
    sheet.open(tab === 'handbook' ? { kind: 'handbook', entry: null } : { kind: 'decision', decision: null })
  }

  return (
    <>
      <Page
        title="Memory"
        actions={
          <Button variant="primary" icon={<Plus aria-hidden className="size-5" />} onClick={addNew}>
            {TAB_COPY[tab].add}
          </Button>
        }
      >
        <div className="space-y-6">
          <div className="space-y-3">
            <Segmented label="Memory" value={tab} onChange={setTab} options={TAB_OPTIONS} />
            <SearchField value={search} onChange={setSearch} label={TAB_COPY[tab].search} />
          </div>
          {tab === 'handbook' ? (
            <HandbookTab
              handbook={handbook}
              search={search}
              onClearSearch={() => setSearch('')}
              onOpen={(entry) => sheet.open({ kind: 'handbook', entry })}
            />
          ) : (
            <DecisionsTab
              decisions={decisions}
              search={search}
              onClearSearch={() => setSearch('')}
              onOpen={(decision) => sheet.open({ kind: 'decision', decision })}
            />
          )}
        </div>
      </Page>

      <HandbookSheet
        key={`handbook-${sheet.session}`}
        open={target?.kind === 'handbook'}
        entry={target?.kind === 'handbook' ? target.entry : null}
        categories={categoriesOf(handbook.data ?? [])}
        onClose={sheet.close}
      />
      <DecisionSheet
        key={`decision-${sheet.session}`}
        open={target?.kind === 'decision'}
        decision={target?.kind === 'decision' ? target.decision : null}
        onClose={sheet.close}
      />
    </>
  )
}
