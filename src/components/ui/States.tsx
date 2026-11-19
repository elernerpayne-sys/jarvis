import type { ReactNode } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'

import { cn } from '@/lib/cn'
import { errorMessage } from '@/services/errors'
import { Button } from '@/components/ui/Button'

/** A quiet placeholder block. Shape it like the content it stands in for. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-lg bg-raised-2', className)} />
}

/** Placeholder for a `<List>`: `count` rows with a title and a subtitle line. */
export function SkeletonRows({ count = 4, label = 'Loading' }: { count?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="divide-y divide-line border-y border-line">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex min-h-16 items-center gap-3 py-3">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3.5 w-3/4" />
          </div>
          <Skeleton className="h-3.5 w-12" />
        </div>
      ))}
    </div>
  )
}

/** Nothing here yet: one sentence, and the next thing to do if there is one. */
export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon?: ReactNode
  title: string
  body?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-start gap-3 rounded-2xl border border-dashed border-line-strong px-5 py-8', className)}>
      {icon ? <span className="text-smoke [&>svg]:size-6">{icon}</span> : null}
      <div>
        <p className="text-base text-bone">{title}</p>
        {body ? <p className="mt-1 text-sm text-ash">{body}</p> : null}
      </div>
      {action}
    </div>
  )
}

/** Something failed to load: what happened, and a way to try again. */
export function ErrorState({
  title,
  message,
  onRetry,
  retrying = false,
  className,
}: {
  title: string
  message?: string
  onRetry?: () => void
  retrying?: boolean
  className?: string
}) {
  return (
    <div role="alert" className={cn('flex flex-col items-start gap-3 rounded-2xl border border-bad/25 bg-bad-soft px-5 py-6', className)}>
      <div>
        <p className="text-base text-bone">{title}</p>
        {message ? <p className="mt-1 text-sm text-ash">{message}</p> : null}
      </div>
      {onRetry ? (
        <Button size="sm" onClick={onRetry} loading={retrying}>
          Try again
        </Button>
      ) : null}
    </div>
  )
}

export interface QueryViewProps<T> {
  query: UseQueryResult<T>
  /** Shown until the first result arrives. Use skeletons shaped like the content. */
  loading: ReactNode
  /** Headline of the error state, e.g. "Couldn't load calls." */
  errorTitle: string
  /** Return true when the data loaded but there is nothing to show. */
  isEmpty?: (data: T) => boolean
  /** Shown when `isEmpty` returns true. */
  empty?: ReactNode
  children: (data: T) => ReactNode
}

/**
 * Renders a query's loading, error, empty and loaded states.
 * Once data has loaded it stays on screen through refetches and later errors.
 */
export function QueryView<T>({ query, loading, errorTitle, isEmpty, empty, children }: QueryViewProps<T>) {
  if (query.data !== undefined) {
    if (isEmpty?.(query.data)) return <>{empty}</>
    return <>{children(query.data)}</>
  }
  if (query.isError) {
    return (
      <ErrorState
        title={errorTitle}
        message={errorMessage(query.error, 'Check your connection and try again.')}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    )
  }
  return <>{loading}</>
}
