import { useEffect, useState } from 'react'
import { Plus, SquareTerminal } from 'lucide-react'
import { Link } from 'react-router'

import { formatRelative } from '@/lib/format'
import { routes } from '@/lib/links'
import { TASK_STATUS } from '@/lib/status'
import type { Task } from '@/lib/types'
import { useTasks } from '@/services/hooks'
import { buttonClass } from '@/components/ui/Button'
import { List, ListRow } from '@/components/ui/List'
import { Page, Section } from '@/components/ui/Page'
import { EmptyState, QueryView, SkeletonRows } from '@/components/ui/States'
import { StatusDot } from '@/components/ui/StatusDot'
import { groupTasks } from '@/features/code/taskGroups'

/** The current time, refreshed every so often so "4m ago" keeps counting. */
function useNow(everyMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), everyMs)
    return () => clearInterval(timer)
  }, [everyMs])
  return now
}

function NewTaskLink() {
  return (
    <Link to={routes.newTask} className={buttonClass({ variant: 'primary' })}>
      <Plus aria-hidden className="size-5" />
      New task
    </Link>
  )
}

function TaskRow({ task, now }: { task: Task; now: Date }) {
  return (
    <ListRow
      to={routes.task(task.id)}
      title={task.title}
      subtitle={<span className="break-all font-mono">{task.repo}</span>}
      trailing={
        <span className="flex flex-col items-end gap-1">
          <StatusDot {...TASK_STATUS[task.status]} />
          <time dateTime={task.updated_at} className="text-xs text-smoke">
            {formatRelative(task.updated_at, now)}
          </time>
        </span>
      }
    />
  )
}

function TaskSection({ title, tasks, now }: { title: string; tasks: Task[]; now: Date }) {
  if (tasks.length === 0) return null
  return (
    <Section title={title}>
      <List label={title}>
        {tasks.map((task) => (
          <TaskRow key={task.id} task={task} now={now} />
        ))}
      </List>
    </Section>
  )
}

function TaskSections({ tasks }: { tasks: Task[] }) {
  const now = useNow()
  const { inProgress, finished } = groupTasks(tasks)
  return (
    <>
      <TaskSection title="In progress" tasks={inProgress} now={now} />
      <TaskSection title="Finished" tasks={finished} now={now} />
    </>
  )
}

/** Every coding task: what Jarvis is on now, then what is over. */
export function TaskListPage() {
  const tasks = useTasks()
  // With no tasks the empty state carries the one "New task" button.
  const hasNone = tasks.data?.length === 0

  return (
    <Page title="Code" actions={hasNone ? undefined : <NewTaskLink />}>
      <QueryView
        query={tasks}
        loading={<SkeletonRows count={5} label="Loading tasks" />}
        errorTitle="Couldn’t load tasks."
        isEmpty={(list) => list.length === 0}
        empty={
          <EmptyState
            icon={<SquareTerminal aria-hidden />}
            title="No tasks yet."
            body="Start one and Jarvis will get to work."
            action={<NewTaskLink />}
          />
        }
      >
        {(list) => <TaskSections tasks={list} />}
      </QueryView>
    </Page>
  )
}
