import { Phone } from 'lucide-react'

import { formatDayTime, formatDuration, formatPhone } from '@/lib/format'
import { CALL_OUTCOME } from '@/lib/status'
import type { CallSummary, TranscriptTurn } from '@/lib/types'
import { errorMessage, isNotFound } from '@/services/errors'
import { useCall } from '@/services/hooks'
import { buttonClass } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States'
import { StatusDot } from '@/components/ui/StatusDot'
import { useListedCall } from '@/features/receptionist/cache'
import { callerLabel, noTranscriptCopy, telHref } from '@/features/receptionist/lib'
import { Transcript, TranscriptSkeleton } from '@/features/receptionist/Transcript'

function CallBackLink({ phone }: { phone: string }) {
  return (
    <a href={telHref(phone)} className={buttonClass({ variant: 'secondary', size: 'lg' })}>
      <Phone aria-hidden className="size-4" />
      Call back
    </a>
  )
}

function CallDetail({
  call,
  transcript,
}: {
  call: CallSummary
  /** Undefined while the full call is still loading. */
  transcript: readonly TranscriptTurn[] | undefined
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <StatusDot {...CALL_OUTCOME[call.outcome]} />
          <time dateTime={call.started_at} className="text-sm text-ash tabular-nums">
            {formatDayTime(call.started_at)}
          </time>
        </div>
        {call.duration_seconds > 0 ? (
          <p className="text-sm text-ash tabular-nums">Lasted {formatDuration(call.duration_seconds)}</p>
        ) : null}
      </div>

      {call.summary ? <p className="text-base text-bone">{call.summary}</p> : null}

      {transcript === undefined ? (
        <TranscriptSkeleton />
      ) : transcript.length === 0 ? (
        <p className="text-base text-ash">{noTranscriptCopy(call.outcome)}</p>
      ) : (
        <section aria-label="Transcript" className="border-t border-line pt-6">
          <Transcript turns={transcript} />
        </section>
      )}
    </div>
  )
}

function CallSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-28" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
      <TranscriptSkeleton label="Loading call" />
    </div>
  )
}

/**
 * One call: how it ended, when, the summary and the full transcript.
 * Open whenever `callId` is set; the shop screen keeps that id in the URL.
 */
export function CallSheet({ callId, onClose }: { callId: string | null; onClose: () => void }) {
  const query = useCall(callId)
  const listed = useListedCall(callId)
  // Until the full call arrives, show what the list already knows about it.
  const call: CallSummary | undefined = query.data ?? (query.isError ? undefined : listed)

  return (
    <Sheet
      open={callId !== null}
      onClose={onClose}
      title={call ? callerLabel(call) : 'Call'}
      // With a name in the title, the number goes underneath it.
      description={call?.caller_name?.trim() ? formatPhone(call.caller_phone) || undefined : undefined}
      footer={call?.caller_phone ? <CallBackLink phone={call.caller_phone} /> : undefined}
    >
      {call ? (
        <CallDetail call={call} transcript={query.data ? (query.data.transcript ?? []) : undefined} />
      ) : isNotFound(query.error) ? (
        <EmptyState title="This call is no longer available." />
      ) : query.isError ? (
        <ErrorState
          title="Couldn’t load this call."
          message={errorMessage(query.error, 'Check your connection and try again.')}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      ) : (
        <CallSkeleton />
      )}
    </Sheet>
  )
}
