import { cn } from '@/lib/cn'
import { useTaskEvents } from '@/services/hooks'
import { Section } from '@/components/ui/Page'
import { EmptyState, QueryView, Skeleton } from '@/components/ui/States'
import { TaskLog } from '@/features/code/TaskLog'

function LogSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading progress"
      className="space-y-3.5 rounded-2xl border border-line bg-raised px-4 py-5"
    >
      {['w-3/5', 'w-4/5', 'w-2/5', 'w-3/4'].map((width) => (
        <div key={width} className="flex items-center gap-3">
          <Skeleton className="h-3 w-12" />
          <Skeleton className={cn('h-3.5', width)} />
        </div>
      ))}
    </div>
  )
}

/** The "Progress" section of a task: its log, kept current as lines arrive. */
export function TaskProgress({ taskId, working }: { taskId: string; working: boolean }) {
  const events = useTaskEvents(taskId)

  return (
    <Section title="Progress">
      <QueryView
        query={events}
        loading={<LogSkeleton />}
        errorTitle="Couldn’t load the progress log."
        // A running task always has its "working" line to show.
        isEmpty={(lines) => lines.length === 0 && !working}
        empty={<EmptyState title="Nothing logged yet." />}
      >
        {(lines) => <TaskLog events={lines} working={working} />}
      </QueryView>
    </Section>
  )
}
