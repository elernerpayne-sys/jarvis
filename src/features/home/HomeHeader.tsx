import { useEffect, useId, useState } from 'react'
import { Bell } from 'lucide-react'

import { formatLongDate, greeting, localDate } from '@/lib/format'
import { api } from '@/services'
import { useAlerts } from '@/services/hooks'
import { IconButton } from '@/components/ui/Button'

/**
 * The current time, refreshed every minute and whenever the app comes back to
 * the foreground: an installed app can sit open from one day into the next.
 */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const tick = () => setNow(new Date())
    const timer = setInterval(tick, 60_000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])

  return now
}

/** The bell. An amber dot means something in the list has not been read. */
function AlertsButton({ onPress }: { onPress: () => void }) {
  const alerts = useAlerts().data
  const unread = alerts?.filter((alert) => alert.read_at === null).length ?? 0
  const countId = useId()

  return (
    <IconButton
      label="Alerts"
      aria-haspopup="dialog"
      aria-describedby={unread > 0 ? countId : undefined}
      onClick={onPress}
      // Pulled out so the bell itself, not its 48px box, sits on the gutter.
      className="-mr-3 -mt-3"
    >
      <span className="relative">
        <Bell aria-hidden className="size-[1.375rem]" />
        {unread > 0 ? (
          <span aria-hidden className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-amber ring-2 ring-ink" />
        ) : null}
      </span>
      {unread > 0 ? (
        <span id={countId} className="sr-only">
          {unread} unread
        </span>
      ) : null}
    </IconButton>
  )
}

/** Today's date, the greeting, and the way into alerts. */
export function HomeHeader({ onOpenAlerts }: { onOpenAlerts: () => void }) {
  const now = useNow()

  return (
    <header className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm text-ash">
          <time dateTime={localDate(now)}>{formatLongDate(now)}</time>
        </p>
        <h1 className="mt-1 font-voice text-3xl text-bone">{greeting(now)}</h1>
        {/* The desktop sidebar already says this. */}
        {api.mode === 'demo' ? (
          <p className="mt-2 text-sm text-smoke lg:hidden">Demo mode. Everything here is sample data.</p>
        ) : null}
      </div>
      <AlertsButton onPress={onOpenAlerts} />
    </header>
  )
}
