import { Navigate, Route, Routes } from 'react-router'

import { routes } from '@/lib/links'
import { NewTaskPage } from '@/features/code/NewTaskPage'
import { TaskDetailPage } from '@/features/code/TaskDetailPage'
import { TaskListPage } from '@/features/code/TaskListPage'

/** The Code tab: every task, the form that starts one, and one task up close. */
export default function Code() {
  return (
    <Routes>
      <Route index element={<TaskListPage />} />
      <Route path="new" element={<NewTaskPage />} />
      <Route path=":taskId" element={<TaskDetailPage />} />
      <Route path="*" element={<Navigate to={routes.code} replace />} />
    </Routes>
  )
}
