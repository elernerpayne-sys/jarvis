import { ACTIVE_TASK_STATUSES } from '@/lib/types'
import type { Task } from '@/lib/types'

/** True while the task is queued, running or waiting for approval. */
export function isActive(task: Pick<Task, 'status'>): boolean {
  return ACTIVE_TASK_STATUSES.includes(task.status)
}

export interface TaskGroups {
  /** Queued, running or waiting for approval. */
  inProgress: Task[]
  /** Done, failed or cancelled. */
  finished: Task[]
}

/**
 * Splits tasks into what is still in flight and what is over.
 * Each group is ordered by its last change, newest first, which is also the
 * time each row shows.
 */
export function groupTasks(tasks: readonly Task[]): TaskGroups {
  const newestFirst = [...tasks].sort(
    (a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at),
  )
  return {
    inProgress: newestFirst.filter(isActive),
    finished: newestFirst.filter((task) => !isActive(task)),
  }
}
