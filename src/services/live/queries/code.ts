import type { Settings, Task, TaskEvent } from '@/lib/types'
import type { JarvisService } from '@/services/types'

import { getClient } from '../client'
import { TASK_COLUMNS, TASK_EVENT_COLUMNS } from '../columns'
import { many, maybeOne, one } from '../db'

const TASK_LIMIT = 200
const TASK_EVENT_LIMIT = 500

export const code: Pick<JarvisService, 'listAllowedRepos' | 'listTasks' | 'getTask' | 'listTaskEvents'> = {
  async listAllowedRepos() {
    const settings = await maybeOne<Pick<Settings, 'allowed_repos'>>(
      getClient().from('settings').select('allowed_repos').limit(1).maybeSingle(),
    )
    return settings?.allowed_repos ?? []
  },

  async listTasks() {
    return many<Task>(
      getClient().from('tasks').select(TASK_COLUMNS).order('created_at', { ascending: false }).limit(TASK_LIMIT),
    )
  },

  async getTask(id) {
    return one<Task>(getClient().from('tasks').select(TASK_COLUMNS).eq('id', id).maybeSingle(), {
      notFound: 'Couldn’t find that task.',
    })
  },

  async listTaskEvents(taskId) {
    // Ask for the newest lines so a very long log keeps its tail, then turn
    // them around so the log reads top to bottom. Lines written in the same
    // instant share a timestamp; the id keeps their order stable.
    const newestFirst = await many<TaskEvent>(
      getClient()
        .from('task_events')
        .select(TASK_EVENT_COLUMNS)
        .eq('task_id', taskId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(TASK_EVENT_LIMIT),
    )
    return newestFirst.reverse()
  },
}
