import { useNavigate } from 'react-router'

import { cn } from '@/lib/cn'
import { formatRelative } from '@/lib/format'
import { alertLink, routes } from '@/lib/links'
import { ALERT_TONE } from '@/lib/status'
import type { Alert, NotifyChannel } from '@/lib/types'
import { errorMessage } from '@/services/errors'
import { useAlerts, useMarkAlertRead, useMarkAllAlertsRead } from '@/services/hooks'
import { Button } from '@/components/ui/Button'
import { List, ListRow } from '@/components/ui/List'
import { Sheet } from '@/components/ui/Sheet'
import { EmptyState, QueryView, SkeletonRows } from '@/components/ui/States'
import { Dot } from '@/components/ui/StatusDot'

/** How the alert got to the owner, said from Jarvis's side. */
const REACHED_BY: Record<NotifyChannel, string> = {
  call: 'Called you',
  text: 'Texted you',
  in_app: 'In the app',
}

function isUnread(alert: Alert): boolean {
  return alert.read_at === null
}

function AlertRow({ alert, onPress }: { alert: Alert; onPress: () => void }) {
  const unread = isUnread(alert)
  return (
    <ListRow
      onClick={onPress}
      leading={<Dot tone={ALERT_TONE[alert.type]} className={cn('mt-1', !unread && 'opacity-40')} />}
      title={
        // Wrapped in full: the alert is short and the owner should not have
        // to open it to read it. Weight as well as colour marks unread, for
        // those who cannot tell the two greys apart.
        <span className={cn('block whitespace-normal', unread ? 'font-medium text-bone' : 'text-ash')}>
          {unread ? <span className="sr-only">Unread. </span> : null}
          {alert.title}
        </span>
      }
      trailing={<time dateTime={alert.created_at}>{formatRelative(alert.created_at)}</time>}
    >
      {/* The body goes here rather than in `subtitle`, which clips to two lines. */}
      {alert.body ? <span className="mt-0.5 block text-sm text-ash">{alert.body}</span> : null}
      <span className="mt-1 block text-sm text-smoke">{REACHED_BY[alert.channel]}</span>
    </ListRow>
  )
}

/** Mounted only while the sheet is open. */
function AlertsList({ onClose }: { onClose: () => void }) {
  const query = useAlerts()
  const markRead = useMarkAlertRead()
  const markAllRead = useMarkAllAlertsRead()
  const navigate = useNavigate()

  function openAlert(alert: Alert) {
    if (isUnread(alert)) markRead.mutate(alert.id)
    onClose()
    const target = alertLink(alert)
    // An alert about nothing in particular points Home, where we already are.
    if (target !== routes.home) navigate(target)
  }

  return (
    <QueryView
      query={query}
      loading={<SkeletonRows count={4} label="Loading alerts" />}
      errorTitle="Couldn’t load alerts."
      isEmpty={(alerts) => alerts.length === 0}
      empty={<EmptyState title="No alerts." body="Jarvis will flag anything that needs you." />}
    >
      {(alerts) => {
        const unread = alerts.filter(isUnread).length
        return (
          <>
            {unread > 0 ? (
              <div className="mb-2 flex min-h-12 items-center justify-between gap-3">
                <p className="text-sm text-ash tabular-nums">{unread} unread</p>
                <Button
                  variant="ghost"
                  className="-mr-4"
                  loading={markAllRead.isPending}
                  onClick={() => markAllRead.mutate()}
                >
                  Mark all read
                </Button>
              </div>
            ) : null}
            {/* Said here, not in a toast: toasts sit behind an open sheet. */}
            {markAllRead.isError ? (
              <p role="alert" className="mb-3 text-sm text-bad">
                Couldn’t mark alerts read. {errorMessage(markAllRead.error, 'Check your connection and try again.')}
              </p>
            ) : null}
            <List label="Alerts">
              {alerts.map((alert) => (
                <AlertRow key={alert.id} alert={alert} onPress={() => openAlert(alert)} />
              ))}
            </List>
          </>
        )
      }}
    </QueryView>
  )
}

/** Everything Jarvis has flagged, newest first. Pressing one opens what it is about. */
export function AlertsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Alerts">
      <AlertsList onClose={onClose} />
    </Sheet>
  )
}
