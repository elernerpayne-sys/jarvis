import type { ReactNode } from 'react'
import { ChevronLeft } from 'lucide-react'
import { Link } from 'react-router'

import { cn } from '@/lib/cn'

/**
 * The frame of every screen: a centered column with the page gutter, an
 * optional back link, the title, and room for one or two actions.
 */
export function Page({
  title,
  subtitle,
  back,
  actions,
  children,
  className,
}: {
  title: string
  subtitle?: ReactNode
  /** Shown above the title on detail screens. */
  back?: { to: string; label: string }
  /** Right of the title: at most two buttons. */
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('mx-auto w-full max-w-[45rem] px-5 pb-12 pt-6 lg:pt-10', className)}>
      {back ? (
        <Link
          to={back.to}
          className="-ml-2 mb-2 inline-flex h-11 items-center gap-1 rounded-xl pl-1 pr-3 text-sm text-ash hover:text-bone"
        >
          <ChevronLeft aria-hidden className="size-4" />
          {back.label}
        </Link>
      ) : null}
      <header className="mb-8 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-voice text-2xl text-bone">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-ash">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      <div className="space-y-10">{children}</div>
    </div>
  )
}

/** A titled block inside a page. `count` shows quietly beside the title. */
export function Section({
  title,
  count,
  action,
  children,
  className,
}: {
  title: string
  count?: number
  /** Right of the heading: a filter or a small button. */
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={className}>
      <div className="mb-3 flex min-h-11 items-center justify-between gap-3">
        <h2 className="text-base font-medium text-bone">
          {title}
          {count !== undefined ? <span className="ml-2 font-normal text-smoke tabular-nums">{count}</span> : null}
        </h2>
        {action}
      </div>
      {children}
    </section>
  )
}

/** A small quiet label, for tags and categories. */
export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex h-6 items-center rounded-md bg-raised-2 px-2 text-xs text-ash', className)}>
      {children}
    </span>
  )
}
