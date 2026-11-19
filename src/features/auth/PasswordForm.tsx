import { useState } from 'react'
import type { FormEvent } from 'react'

import { api, errorMessage } from '@/services'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Form'
import { EmailField, focusField } from '@/features/auth/EmailField'
import { emailProblem, passwordProblem } from '@/features/auth/validation'

/** Email and password. On success the app swaps in by itself; nothing to do here. */
export function PasswordForm({
  email,
  onEmailChange,
}: {
  email: string
  onEmailChange: (email: string) => void
}) {
  const [password, setPassword] = useState('')
  const [problems, setProblems] = useState<{ email: string | null; password: string | null }>({
    email: null,
    password: null,
  })
  const [signingIn, setSigningIn] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const found = { email: emailProblem(email), password: passwordProblem(password) }
    setProblems(found)
    if (found.email || found.password) {
      focusField(event.currentTarget, found.email ? 'email' : 'password')
      return
    }

    setSigningIn(true)
    setFailure(null)
    try {
      await api.auth.signInWithPassword(email.trim(), password)
    } catch (error) {
      setFailure(errorMessage(error, 'Couldn’t sign you in. Check your connection and try again.'))
    } finally {
      setSigningIn(false)
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} noValidate className="space-y-5">
      <EmailField
        value={email}
        onChange={(value) => {
          onEmailChange(value)
          setProblems((current) => ({ ...current, email: null }))
        }}
        error={problems.email}
      />
      <Field label="Password" error={problems.password}>
        {(control) => (
          <Input
            {...control}
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value)
              setProblems((current) => ({ ...current, password: null }))
            }}
          />
        )}
      </Field>
      <Button type="submit" variant="primary" size="lg" fullWidth loading={signingIn}>
        Sign in
      </Button>
      {failure ? (
        <p role="alert" className="text-sm text-bad">
          {failure}
        </p>
      ) : null}
    </form>
  )
}
