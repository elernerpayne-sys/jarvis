import { Copy, ExternalLink } from 'lucide-react'

import { cn } from '@/lib/cn'
import type { Task } from '@/lib/types'
import { IconButton, buttonClass } from '@/components/ui/Button'
import { Section } from '@/components/ui/Page'
import { useToast } from '@/components/ui/Toast'
import { isActive } from '@/features/code/taskGroups'

/** The URL if it is a normal web link, else null. It arrives from the backend, so check. */
function webLink(url: string | null): string | null {
  if (!url) return null
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:' ? url : null
  } catch {
    return null
  }
}

/** The branch Jarvis is working on, and the pull request once there is one. */
export function TaskBranch({ task }: { task: Task }) {
  const toast = useToast()
  const pullRequest = webLink(task.pr_url)

  async function copy(branch: string) {
    try {
      // The clipboard is missing on plain-http pages, such as a dev server
      // opened from the phone; that lands in the catch as well.
      await navigator.clipboard.writeText(branch)
      toast('Copied', { tone: 'ok' })
    } catch {
      toast('Couldn’t copy. Press and hold the branch name instead.', { tone: 'bad' })
    }
  }

  return (
    <Section title="Branch">
      {task.branch ? (
        <div className="flex min-h-16 items-center gap-2 border-y border-line py-2">
          <p className="min-w-0 flex-1 select-all break-all font-mono text-sm text-bone">{task.branch}</p>
          <IconButton
            label="Copy branch name"
            className="-mr-2"
            onClick={() => void copy(task.branch ?? '')}
          >
            <Copy aria-hidden className="size-5" />
          </IconButton>
        </div>
      ) : (
        <p className="text-smoke">{isActive(task) ? 'No branch yet' : 'No branch was made'}</p>
      )}
      {pullRequest ? (
        <a
          href={pullRequest}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(buttonClass(), 'mt-4')}
        >
          <ExternalLink aria-hidden className="size-4" />
          Open pull request
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      ) : null}
    </Section>
  )
}
