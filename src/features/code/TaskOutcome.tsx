import { formatDay, formatTime } from '@/lib/format'
import type { Task } from '@/lib/types'
import { Section } from '@/components/ui/Page'

/** "today at 3:05 PM", "yesterday at 3:05 PM", "Nov 12 at 3:05 PM" */
function formatWhen(value: string): string {
  const day = formatDay(value)
  const midSentence = day === 'Today' || day === 'Yesterday' ? day.toLowerCase() : day
  return `${midSentence} at ${formatTime(value)}`
}

/** Looks like `<ErrorState>`, but keeps line breaks and wraps long paths. */
function FailureNote({ reason }: { reason: string | null }) {
  return (
    <div role="alert" className="rounded-2xl border border-bad/25 bg-bad-soft px-5 py-6">
      <p className="text-base text-bone">This task failed</p>
      <p className="mt-1 whitespace-pre-line text-sm text-ash wrap-anywhere">
        {reason ?? 'Jarvis didn’t say why. The progress log may show what happened.'}
      </p>
    </div>
  )
}

/**
 * How a finished task ended: the result, the failure, or a note that it was
 * cancelled. Renders nothing while the task is still in flight.
 */
export function TaskOutcome({ task }: { task: Task }) {
  switch (task.status) {
    case 'done':
      return (
        <Section title="Result">
          {task.result_summary ? (
            // Jarvis reporting back, so it is set in Jarvis's voice.
            <p className="whitespace-pre-line font-voice text-lg text-bone wrap-anywhere">
              {task.result_summary}
            </p>
          ) : (
            <p className="text-ash">Jarvis finished without leaving a summary.</p>
          )}
        </Section>
      )
    case 'failed':
      return <FailureNote reason={task.error} />
    case 'cancelled': {
      const at = task.finished_at ?? task.updated_at
      return (
        <p className="text-ash">
          Cancelled <time dateTime={at}>{formatWhen(at)}</time>.
        </p>
      )
    }
    default:
      return null
  }
}
