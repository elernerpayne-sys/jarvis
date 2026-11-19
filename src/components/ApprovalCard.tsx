import { useState } from 'react'
import { Link } from 'react-router'

import { formatRelative } from '@/lib/format'
import { routes } from '@/lib/links'
import { APPROVAL_KIND_LABEL } from '@/lib/status'
import type { Approval, ApprovalDecision } from '@/lib/types'
import { errorMessage } from '@/services/errors'
import { useDecideApproval } from '@/services/hooks'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/Sheet'
import { useToast } from '@/components/ui/Toast'

const VERB: Record<ApprovalDecision, string> = { approved: 'Approve', denied: 'Deny' }
const DONE: Record<ApprovalDecision, string> = { approved: 'Approved', denied: 'Denied' }

/**
 * One thing Jarvis is waiting on: the question, then Deny and Approve, each
 * behind a confirm step. Used on Home and on a task that needs approval.
 */
export function ApprovalCard({
  approval,
  showTaskLink = true,
}: {
  approval: Approval
  /** Hide the "View task" link when the card already sits on that task. */
  showTaskLink?: boolean
}) {
  const decide = useDecideApproval()
  const toast = useToast()
  // The decision waiting for confirmation, if any.
  const [asking, setAsking] = useState<ApprovalDecision | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  function close() {
    if (decide.isPending) return
    setAsking(null)
    setFailure(null)
  }

  function confirm() {
    if (!asking) return
    const decision = asking
    setFailure(null)
    decide.mutate(
      { id: approval.id, decision },
      {
        onSuccess: () => {
          setAsking(null)
          toast(DONE[decision], { tone: decision === 'approved' ? 'ok' : 'neutral' })
        },
        onError: (error) => setFailure(errorMessage(error, 'Check your connection and try again.')),
      },
    )
  }

  return (
    <Card>
      <div className="flex items-baseline justify-between gap-3 text-sm text-ash">
        <span>{APPROVAL_KIND_LABEL[approval.kind]}</span>
        <time dateTime={approval.requested_at} className="shrink-0 tabular-nums">
          {formatRelative(approval.requested_at)}
        </time>
      </div>
      <p className="mt-2 font-voice text-xl text-bone">{approval.title}</p>
      {approval.detail ? (
        <p className="mt-2 whitespace-pre-line text-sm text-ash">{approval.detail}</p>
      ) : null}
      {showTaskLink && approval.task_id ? (
        <Link
          to={routes.task(approval.task_id)}
          className="mt-2 inline-flex h-11 items-center text-sm text-ash underline decoration-line-strong underline-offset-4 hover:text-bone"
        >
          View the task
        </Link>
      ) : null}
      <div className="mt-4 flex gap-3">
        <Button size="lg" fullWidth onClick={() => setAsking('denied')}>
          Deny
        </Button>
        <Button size="lg" fullWidth variant="primary" onClick={() => setAsking('approved')}>
          Approve
        </Button>
      </div>

      <ConfirmDialog
        open={asking !== null}
        title={asking === 'denied' ? 'Deny this request?' : 'Approve this request?'}
        confirmLabel={asking ? VERB[asking] : ''}
        tone={asking === 'denied' ? 'danger' : 'default'}
        busy={decide.isPending}
        onConfirm={confirm}
        onCancel={close}
        body={
          <>
            <p className="font-voice text-lg text-bone">{approval.title}</p>
            <p className="mt-3">
              {asking === 'denied'
                ? 'Jarvis will stop and will not go ahead with this.'
                : 'Jarvis will go ahead as soon as you approve.'}
            </p>
            {failure ? (
              <p role="alert" className="mt-3 text-bad">
                {asking === 'denied' ? 'Couldn’t deny it. ' : 'Couldn’t approve it. '}
                {failure}
              </p>
            ) : null}
          </>
        }
      />
    </Card>
  )
}
