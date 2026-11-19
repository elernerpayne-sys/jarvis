import { useState } from 'react'
import type { FormEvent } from 'react'
import { Trash2 } from 'lucide-react'

import { cn } from '@/lib/cn'
import { Button, IconButton } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Form'
import { List } from '@/components/ui/List'
import { Section } from '@/components/ui/Page'
import { ConfirmDialog } from '@/components/ui/Sheet'
import { EmptyState } from '@/components/ui/States'
import { parseRepo } from '@/features/settings/repos'
import type { SaveSettings } from '@/features/settings/useSettingsEditor'

/** "owner/name", allowed to wrap after the slash before it breaks inside a word. */
function RepoName({ repo, className }: { repo: string; className?: string }) {
  const slash = repo.indexOf('/') + 1
  return (
    <span className={cn('min-w-0 font-mono [overflow-wrap:anywhere]', className)}>
      {repo.slice(0, slash)}
      <wbr />
      {repo.slice(slash)}
    </span>
  )
}

function AddRepoForm({ repos, save }: { repos: readonly string[]; save: SaveSettings }) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const result = parseRepo(draft, repos)
    if (!result.ok) {
      setError(result.error)
      return
    }
    save({ allowed_repos: [...repos, result.repo] }, { done: 'Added' })
    setDraft('')
    setError(null)
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-6">
      <Field label="Add a repo" error={error}>
        {(control) => (
          <div className="flex gap-3">
            <Input
              {...control}
              placeholder="owner/name"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="done"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value)
                setError(null)
              }}
              className="min-w-0 flex-1 font-mono text-sm"
            />
            <Button type="submit">Add</Button>
          </div>
        )}
      </Field>
    </form>
  )
}

/** The repos Jarvis may run coding tasks in. The New task form offers these. */
export function ReposSection({ repos, save }: { repos: readonly string[]; save: SaveSettings }) {
  // The repo the confirm dialog is about. It outlives `asking` so the name
  // stays in the dialog while it slides away.
  const [removing, setRemoving] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)

  function askToRemove(repo: string) {
    setRemoving(repo)
    setAsking(true)
  }

  function confirmRemove() {
    setAsking(false)
    if (removing === null) return
    save({ allowed_repos: repos.filter((repo) => repo !== removing) }, { done: 'Removed' })
  }

  return (
    <Section title="Repos Jarvis can work in" count={repos.length || undefined}>
      {repos.length === 0 ? (
        <EmptyState title="No repos yet." body="Add one so you can start coding tasks." />
      ) : (
        <List>
          {repos.map((repo) => (
            <li key={repo} className="flex min-h-16 items-center justify-between gap-3 py-2">
              <RepoName repo={repo} className="text-sm text-bone" />
              <IconButton label={`Remove ${repo}`} onClick={() => askToRemove(repo)} className="-mr-3">
                <Trash2 aria-hidden className="size-5" />
              </IconButton>
            </li>
          ))}
        </List>
      )}

      <AddRepoForm repos={repos} save={save} />

      <ConfirmDialog
        open={asking}
        title="Remove this repo?"
        body={
          <>
            Jarvis won’t start new coding tasks in{' '}
            {removing ? <RepoName repo={removing} className="text-sm text-bone" /> : null}. Tasks already under way keep
            going.
          </>
        }
        confirmLabel="Remove"
        tone="danger"
        onConfirm={confirmRemove}
        onCancel={() => setAsking(false)}
      />
    </Section>
  )
}
