import { useState } from 'react'

import type { Task } from '@/lib/types'
import { errorMessage } from '@/services/errors'
import { useCancelTask } from '@/services/hooks'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/Sheet'
import { useToast } from '@/components/ui/Toast'
import { isActive } from '@/features/code/taskGroups'

/**
 * "Cancel task", behind a confirm step. The button only shows while the task
 * can still be cancelled.
 *
 * Keep this mounted for every status: the task flips to "cancelled" the moment
 * the request lands, and the confirm step has to outlive that to close itself
 * and say "Task cancelled".
 */
export function CancelTask({ task }: { task: Task }) {
  const cancel = useCancelTask()
  const toast = useToast()
  const [asking, setAsking] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const active = isActive(task)

  function close() {
    if (cancel.isPending) return
    setAsking(false)
    setFailure(null)
  }

  function confirm() {
    setFailure(null)
    cancel.mutate(task.id, {
      onSuccess: () => {
        setAsking(false)
        toast('Task cancelled')
      },
      onError: (error) => setFailure(errorMessage(error, 'Check your connection and try again.')),
    })
  }

  // If the task ends on its own while the question is up, there is nothing
  // left to cancel.
  const open = asking && (active || cancel.isPending)
  if (!active && !open) return null

  return (
    <div>
      {active ? (
        <Button variant="danger" size="lg" className="w-full sm:w-auto" onClick={() => setAsking(true)}>
          Cancel task
        </Button>
      ) : null}
      <ConfirmDialog
        open={open}
        tone="danger"
        title="Cancel this task?"
        confirmLabel="Cancel task"
        cancelLabel="Keep running"
        busy={cancel.isPending}
        onConfirm={confirm}
        onCancel={close}
        body={
          <>
            <p>Jarvis will stop working on it. Anything not yet pushed is discarded.</p>
            {failure ? (
              <p role="alert" className="mt-3 text-bad">
                Couldn’t cancel it. {failure}
              </p>
            ) : null}
          </>
        }
      />
    </div>
  )
}
