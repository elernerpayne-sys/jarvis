import { RefreshCw } from 'lucide-react'

import { formatRelative } from '@/lib/format'
import { CONNECTION_STATE, SERVICE_LABEL, SERVICE_PURPOSE } from '@/lib/status'
import { SERVICE_KEYS } from '@/lib/types'
import type { ConnectionStatus } from '@/lib/types'
import { errorMessage } from '@/services/errors'
import { useConnections } from '@/services/hooks'
import { Button } from '@/components/ui/Button'
import { List } from '@/components/ui/List'
import { Section } from '@/components/ui/Page'
import { QueryView, SkeletonRows } from '@/components/ui/States'
import { StatusDot } from '@/components/ui/StatusDot'
import { useNow } from '@/features/settings/useNow'

/** "Checked 4m ago", "Checked just now", "Checked yesterday". */
function checkedLine(checkedAt: string, now: Date): string {
  const when = formatRelative(checkedAt, now)
  // Mid-sentence, only names keep their capital ("Nov 12", "Thursday").
  const midSentence = /^(Just now|Today|Yesterday|Tomorrow)$/.test(when) ? when.toLowerCase() : when
  return `Checked ${midSentence}`
}

function ConnectionRow({ connection }: { connection: ConnectionStatus }) {
  return (
    <li className="flex min-h-16 items-start gap-3 py-3.5">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-base text-bone">{SERVICE_LABEL[connection.service]}</span>
          <span className="text-sm text-smoke">{SERVICE_PURPOSE[connection.service]}</span>
        </p>
        <p className="mt-0.5 text-sm text-ash">{connection.detail}</p>
      </div>
      <StatusDot {...CONNECTION_STATE[connection.state]} className="pt-0.5" />
    </li>
  )
}

function ConnectionList({
  connections,
  recheckError,
}: {
  connections: readonly ConnectionStatus[]
  /** Why the latest "Check again" failed, when the list is an older result. */
  recheckError: string | null
}) {
  const now = useNow()
  // Always the same order, whatever order the backend answered in.
  const ordered = SERVICE_KEYS.flatMap((key) => connections.filter((item) => item.service === key))
  const checkedAt = ordered.map((item) => item.checked_at).sort().at(-1)

  return (
    <>
      <List>
        {ordered.map((connection) => (
          <ConnectionRow key={connection.service} connection={connection} />
        ))}
      </List>
      {recheckError ? (
        <p role="alert" className="mt-3 text-sm text-bad">
          Couldn’t check again. {recheckError}
        </p>
      ) : null}
      {checkedAt ? (
        <p className="mt-3 text-sm text-smoke">
          <time dateTime={checkedAt}>{checkedLine(checkedAt, now)}</time>
        </p>
      ) : null}
    </>
  )
}

/** Whether each outside service Jarvis depends on is reachable right now. */
export function ConnectionsSection() {
  const query = useConnections()
  const checking = query.isFetching

  return (
    <Section
      title="Connections"
      action={
        <Button
          variant="ghost"
          className="-mr-3"
          icon={<RefreshCw aria-hidden className="size-4" />}
          loading={checking}
          onClick={() => void query.refetch()}
        >
          {checking ? 'Checking…' : 'Check again'}
        </Button>
      }
    >
      <QueryView
        query={query}
        loading={<SkeletonRows count={4} label="Checking connections" />}
        errorTitle="Couldn’t check your connections."
      >
        {(connections) => (
          <ConnectionList
            connections={connections}
            recheckError={
              query.isError && !checking ? errorMessage(query.error, 'Check your connection and try again.') : null
            }
          />
        )}
      </QueryView>
    </Section>
  )
}
