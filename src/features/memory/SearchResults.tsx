import type { ReactNode } from 'react'

import { plural } from '@/lib/format'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/States'

/**
 * Wraps a searched list. With matches it shows the list; with none it says
 * so and offers the way back. Either way the outcome is announced to screen
 * readers, since the list changes while the owner is still typing.
 */
export function SearchResults({
  search,
  count,
  singular,
  pluralForm,
  onClear,
  children,
}: {
  /** The search text as typed. */
  search: string
  /** How many items match. */
  count: number
  /** What one item is called: "entry". */
  singular: string
  /** And several: "entries". */
  pluralForm: string
  onClear: () => void
  /** The list of matches. */
  children: ReactNode
}) {
  const query = search.trim()
  const nothing = query !== '' && count === 0
  return (
    <>
      <p role="status" className="sr-only">
        {query === '' ? '' : nothing ? 'No matches.' : `${plural(count, singular, pluralForm)} found.`}
      </p>
      {nothing ? (
        <EmptyState
          className="wrap-anywhere"
          title={`Nothing matches “${query}”.`}
          action={<Button onClick={onClear}>Clear search</Button>}
        />
      ) : (
        children
      )}
    </>
  )
}
