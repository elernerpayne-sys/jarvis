import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router'

import { cn } from '@/lib/cn'

/** Rows separated by hairlines, sitting directly on the page. */
export function List({
  children,
  className,
  label,
}: {
  children: ReactNode
  className?: string
  /** Names the list for screen readers when there is no visible heading. */
  label?: string
}) {
  return (
    <ul aria-label={label} className={cn('divide-y divide-line border-y border-line', className)}>
      {children}
    </ul>
  )
}

export interface ListRowProps {
  /** Makes the whole row a link. */
  to?: string
  /** Makes the whole row a button. Ignored when `to` is set. */
  onClick?: () => void
  /** Icon or dot at the start of the row. */
  leading?: ReactNode
  title: ReactNode
  /** Second line: secondary details. */
  subtitle?: ReactNode
  /** Right edge: a time, a count, a status. */
  trailing?: ReactNode
  /** Extra content under the text, full width. */
  children?: ReactNode
  className?: string
}

/** One row, at least 64px tall. Shows a chevron when it goes somewhere. */
export function ListRow({
  to,
  onClick,
  leading,
  title,
  subtitle,
  trailing,
  children,
  className,
}: ListRowProps) {
  const interactive = Boolean(to || onClick)
  const body = (
    <>
      {leading ? <span className="flex shrink-0 items-center self-start pt-1">{leading}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-base text-bone">{title}</span>
        {subtitle ? <span className="mt-0.5 line-clamp-2 text-sm text-ash">{subtitle}</span> : null}
        {children}
      </span>
      {trailing ? (
        <span className="shrink-0 self-start pt-0.5 text-right text-sm text-ash tabular-nums">
          {trailing}
        </span>
      ) : null}
      {interactive ? <ChevronRight aria-hidden className="size-4 shrink-0 text-smoke" /> : null}
    </>
  )
  const rowClass = cn(
    'flex min-h-16 w-full items-center gap-3 py-3 text-left',
    interactive && '-mx-2 w-[calc(100%+1rem)] rounded-xl px-2 transition-colors active:bg-raised',
    className,
  )
  return (
    <li>
      {to ? (
        <Link to={to} className={rowClass}>
          {body}
        </Link>
      ) : onClick ? (
        <button type="button" onClick={onClick} className={rowClass}>
          {body}
        </button>
      ) : (
        <div className={rowClass}>{body}</div>
      )}
    </li>
  )
}
