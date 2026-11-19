import { Suspense, useEffect } from 'react'
import type { ComponentType } from 'react'
import { BookOpen, House, Phone, Settings, SquareTerminal } from 'lucide-react'
import { NavLink, Outlet, useLocation } from 'react-router'

import { ErrorBoundary } from '@/app/ErrorBoundary'
import { useRealtimeStatus } from '@/app/RealtimeProvider'
import { cn } from '@/lib/cn'
import { routes } from '@/lib/links'
import { api } from '@/services'
import { usePendingApprovals } from '@/services/hooks'
import { Skeleton, SkeletonRows } from '@/components/ui/States'
import { VoicePill } from '@/features/voice'

interface NavItem {
  to: string
  label: string
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  /** Match the path exactly (Home would otherwise match everything). */
  end?: boolean
}

const NAV: NavItem[] = [
  { to: routes.home, label: 'Home', icon: House, end: true },
  { to: routes.receptionist, label: 'Receptionist', icon: Phone },
  { to: routes.code, label: 'Code', icon: SquareTerminal },
  { to: routes.memory, label: 'Memory', icon: BookOpen },
  { to: routes.settings, label: 'Settings', icon: Settings },
]

/** Shown while a screen's code is loading. */
export function PageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[45rem] px-5 pb-12 pt-6 lg:pt-10">
      <Skeleton className="mb-8 h-8 w-40" />
      <SkeletonRows count={5} label="Loading screen" />
    </div>
  )
}

/** Jump to the top when moving to a different screen. */
function useScrollToTopOnNavigate() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
}

function ConnectionNote() {
  const status = useRealtimeStatus()
  if (status !== 'offline') return null
  return (
    <p role="status" className="border-b border-line bg-raised px-5 py-2 text-center text-sm text-ash">
      Offline. Showing what was last loaded.
    </p>
  )
}

function DemoNote({ className }: { className?: string }) {
  if (api.mode !== 'demo') return null
  return (
    <p className={cn('text-sm text-smoke', className)}>
      Demo mode. Everything here is sample data.
    </p>
  )
}

/**
 * The frame around every signed-in screen: a sidebar on desktop, a bottom tab
 * bar on a phone, and the current screen in between.
 */
export function AppShell() {
  const { pathname } = useLocation()
  useScrollToTopOnNavigate()
  const pending = usePendingApprovals().data?.length ?? 0

  return (
    <div className="min-h-dvh bg-ink text-bone">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-raised-3 focus:px-4 focus:py-3"
      >
        Skip to content
      </a>

      {/* Desktop: sidebar */}
      <nav
        aria-label="Main"
        className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-line px-3 pb-5 pt-8 lg:flex"
      >
        <p className="px-3 font-voice text-2xl text-bone">Jarvis</p>
        <ul className="mt-8 flex-1 space-y-1">
          {NAV.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'group flex h-12 items-center gap-3 rounded-xl px-3 text-base transition-colors',
                    isActive ? 'bg-raised text-bone' : 'text-ash hover:bg-raised hover:text-bone',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <item.icon aria-hidden className={cn('size-5', isActive ? 'text-amber' : '')} />
                    <span className="flex-1">{item.label}</span>
                    {item.end && pending > 0 ? (
                      <span className="text-sm text-amber tabular-nums" aria-label={`${pending} waiting for approval`}>
                        {pending}
                      </span>
                    ) : null}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
        <DemoNote className="px-3" />
      </nav>

      <main
        id="main"
        className="min-h-dvh pb-[calc(4rem+env(safe-area-inset-bottom))] pt-[env(safe-area-inset-top)] lg:pb-0 lg:pl-60"
      >
        <ConnectionNote />
        <ErrorBoundary key={pathname}>
          <Suspense fallback={<PageSkeleton />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>

      <VoicePill />

      {/* Phone: bottom tab bar */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-ink/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        <ul className="mx-auto grid h-16 max-w-xl grid-cols-5">
          {NAV.map((item) => (
            <li key={item.to} className="min-w-0">
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'relative flex h-full flex-col items-center justify-center gap-1 text-xs transition-colors',
                    isActive ? 'text-amber' : 'text-ash active:text-bone',
                  )
                }
              >
                <span className="relative">
                  <item.icon aria-hidden className="size-[1.375rem]" />
                  {item.end && pending > 0 ? (
                    <span
                      className="absolute -right-1.5 -top-1 size-2 rounded-full bg-amber ring-2 ring-ink"
                      role="img"
                      aria-label={`${pending} waiting for approval`}
                    />
                  ) : null}
                </span>
                <span className="max-w-full truncate px-0.5">{item.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
