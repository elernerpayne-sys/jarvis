import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'

import { routes } from '@/lib/links'
import { errorMessage } from '@/services/errors'
import { useAllowedRepos, useCreateTask } from '@/services/hooks'
import { Button, buttonClass } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, Select } from '@/components/ui/Form'
import { Page } from '@/components/ui/Page'
import { EmptyState, QueryView, Skeleton } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { InstructionsField, appendSpoken } from '@/features/code/InstructionsField'
import { useDictation } from '@/features/code/useDictation'

interface FieldErrors {
  repo?: string
  instructions?: string
}

function validate(repo: string, instructions: string): FieldErrors {
  const errors: FieldErrors = {}
  if (!repo) errors.repo = 'Choose a repo.'
  if (!instructions.trim()) errors.instructions = 'Tell Jarvis what to do.'
  return errors
}

function FormSkeleton() {
  return (
    <Card role="status" aria-label="Loading the form" className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-4 w-12" />
        <Skeleton className="h-12 rounded-xl" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
      <Skeleton className="h-13 rounded-xl sm:w-32" />
    </Card>
  )
}

function NewTaskForm({ repos }: { repos: string[] }) {
  const navigate = useNavigate()
  const toast = useToast()
  const create = useCreateTask()
  const formRef = useRef<HTMLFormElement>(null)
  const [repo, setRepo] = useState('')
  const [instructions, setInstructions] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const dictation = useDictation((phrase) =>
    setInstructions((current) => appendSpoken(current, phrase)),
  )

  // With a single allowed repo there is nothing to choose.
  const chosenRepo = repos.includes(repo) ? repo : repos.length === 1 ? repos[0] : ''

  function handleRepo(next: string) {
    setRepo(next)
    setErrors((current) => ({ ...current, repo: undefined }))
  }

  function handleInstructions(next: string) {
    // Typing takes over from dictation. What is on screen is now the text, so
    // the phrase in progress must not arrive a second time.
    dictation.cancel()
    setInstructions(next)
    setErrors((current) => ({ ...current, instructions: undefined }))
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (create.isPending) return

    // Send what is on screen, including a phrase still being spoken.
    const text = appendSpoken(instructions, dictation.interim)
    dictation.cancel()
    setInstructions(text)

    const problems = validate(chosenRepo, text)
    setErrors(problems)
    if (problems.repo || problems.instructions) {
      formRef.current?.querySelector<HTMLElement>(problems.repo ? 'select' : 'textarea')?.focus()
      return
    }

    create.mutate(
      { repo: chosenRepo, instructions: text.trim() },
      {
        onSuccess: (task) => {
          toast('Task started', { tone: 'amber' })
          navigate(routes.task(task.id), { replace: true })
        },
      },
    )
  }

  return (
    <Card>
      <form ref={formRef} noValidate onSubmit={handleSubmit} className="space-y-6">
        <Field label="Repo" error={errors.repo}>
          {(field) => (
            <Select
              {...field}
              value={chosenRepo}
              onChange={(event) => handleRepo(event.target.value)}
              className={chosenRepo ? 'font-mono' : undefined}
            >
              <option value="" disabled>
                Choose a repo
              </option>
              {repos.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <InstructionsField
          value={instructions}
          onChange={handleInstructions}
          error={errors.instructions}
          dictation={dictation}
        />

        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={create.isPending}
          className="w-full sm:w-auto"
        >
          Start task
        </Button>

        {create.isError ? (
          <p role="alert" className="text-sm text-bad">
            Couldn’t start the task. {errorMessage(create.error, 'Check your connection and try again.')}
          </p>
        ) : null}
      </form>
    </Card>
  )
}

/** Hand Jarvis a new coding task: pick a repo, then type or dictate what to do. */
export function NewTaskPage() {
  const repos = useAllowedRepos()

  return (
    <Page title="New task" back={{ to: routes.code, label: 'Code' }}>
      <QueryView
        query={repos}
        loading={<FormSkeleton />}
        errorTitle="Couldn’t load your repos."
        isEmpty={(list) => list.length === 0}
        empty={
          <EmptyState
            title="No repos are allowed yet."
            body="Add one in Settings, then come back."
            action={
              <Link to={routes.settings} className={buttonClass()}>
                Open Settings
              </Link>
            }
          />
        }
      >
        {(list) => <NewTaskForm repos={list} />}
      </QueryView>
    </Page>
  )
}
