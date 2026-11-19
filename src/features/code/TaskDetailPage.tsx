import { Link, Navigate, useParams } from 'react-router'

import { routes } from '@/lib/links'
import { TASK_STATUS } from '@/lib/status'
import type { Task } from '@/lib/types'
import { errorMessage, isNotFound } from '@/services/errors'
import { usePendingApprovals, useTask } from '@/services/hooks'
import { ApprovalCard } from '@/components/ApprovalCard'
import { buttonClass } from '@/components/ui/Button'
import { Page } from '@/components/ui/Page'
import { EmptyState, ErrorState, QueryView, Skeleton } from '@/components/ui/States'
import { StatusDot } from '@/components/ui/StatusDot'
import { CancelTask } from '@/features/code/CancelTask'
import { TaskBranch } from '@/features/code/TaskBranch'
import { TaskInstructions } from '@/features/code/TaskInstructions'
import { TaskOutcome } from '@/features/code/TaskOutcome'
import { TaskProgress } from '@/features/code/TaskProgress'

const BACK = { to: routes.code, label: 'Code' }
/** The heading until the task's own title is known. */
const PLACEHOLDER_TITLE = 'Task'

function DetailSkeleton() {
  return (
    <div role="status" aria-label="Loading task" className="space-y-10">
      <Skeleton className="h-4 w-56" />
      <div className="space-y-3">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-12 rounded-xl" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-56 rounded-2xl" />
      </div>
    </div>
  )
}

/** Under the title: where the task stands, and the repo it runs in. */
function TaskMeta({ task }: { task: Task }) {
  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {/* Announced when Jarvis moves the task on while the screen is open. */}
      <span role="status" aria-label="Status">
        <StatusDot {...TASK_STATUS[task.status]} />
      </span>
      <span className="break-all font-mono">{task.repo}</span>
    </span>
  )
}

/** What Jarvis is waiting on for this task, with Approve and Deny. */
function TaskApproval({ taskId }: { taskId: string }) {
  const pending = usePendingApprovals()

  return (
    <QueryView
      query={pending}
      loading={
        <div role="status" aria-label="Loading the approval">
          <Skeleton className="h-52 rounded-2xl" />
        </div>
      }
      errorTitle="Couldn’t load the approval."
    >
      {(approvals) => {
        const forThisTask = approvals.filter((approval) => approval.task_id === taskId)
        if (forThisTask.length === 0) return <p className="text-ash">Waiting for your approval.</p>
        return (
          // ApprovalCard sets Deny and Approve side by side as full-width
          // buttons that refuse to shrink, so together they overflow the card.
          // Let them share the row until the shared card is fixed.
          <div className="space-y-4 [&_button.w-full]:min-w-0 [&_button.w-full]:shrink">
            {forThisTask.map((approval) => (
              <ApprovalCard key={approval.id} approval={approval} showTaskLink={false} />
            ))}
          </div>
        )
      }}
    </QueryView>
  )
}

function TaskDetail({ taskId }: { taskId: string }) {
  const query = useTask(taskId)
  const task = query.data

  if (isNotFound(query.error)) {
    return (
      <Page title={PLACEHOLDER_TITLE} back={BACK}>
        <EmptyState
          title="This task doesn’t exist."
          body="It may have been removed."
          action={
            <Link to={routes.code} className={buttonClass()}>
              Back to Code
            </Link>
          }
        />
      </Page>
    )
  }

  if (!task) {
    return (
      <Page title={PLACEHOLDER_TITLE} back={BACK}>
        {query.isError ? (
          <ErrorState
            title="Couldn’t load this task."
            message={errorMessage(query.error, 'Check your connection and try again.')}
            onRetry={() => void query.refetch()}
            retrying={query.isFetching}
          />
        ) : (
          <DetailSkeleton />
        )}
      </Page>
    )
  }

  return (
    <Page title={task.title} back={BACK} subtitle={<TaskMeta task={task} />}>
      {task.status === 'needs_approval' ? <TaskApproval taskId={task.id} /> : null}
      <TaskOutcome task={task} />
      <TaskBranch task={task} />
      <TaskProgress taskId={task.id} working={task.status === 'running'} />
      <TaskInstructions text={task.instructions} />
      <CancelTask task={task} />
    </Page>
  )
}

/** One task up close: where it stands, what it did, and a way to stop it. */
export function TaskDetailPage() {
  const { taskId } = useParams()
  if (!taskId) return <Navigate to={routes.code} replace />
  // Keyed, so nothing from one task (an open confirm step, a scrolled log)
  // carries over to the next.
  return <TaskDetail key={taskId} taskId={taskId} />
}
