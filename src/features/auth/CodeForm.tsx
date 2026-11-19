import { useId, useState } from 'react'
import type { FormEvent } from 'react'

import { api, errorMessage } from '@/services'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Form'
import { useToast } from '@/components/ui/Toast'
import { EmailField, focusField } from '@/features/auth/EmailField'
import { useCooldown } from '@/features/auth/useCooldown'
import { CODE_LENGTH, codeProblem, digitsOnly, emailProblem } from '@/features/auth/validation'

/** How long to wait before another code can be asked for. */
const RESEND_SECONDS = 30

/**
 * Sign in with a one-time code: ask for the email, send the code, then
 * check the six digits the owner types back.
 */
export function CodeForm({
  email,
  onEmailChange,
}: {
  email: string
  onEmailChange: (email: string) => void
}) {
  const toast = useToast()
  const sentNoteId = useId()
  // The address the latest code went to. Null until one has been sent.
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState<'sending' | 'verifying' | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const cooldown = useCooldown(RESEND_SECONDS)

  /** Returns true when the code went out. */
  async function sendCode(to: string): Promise<boolean> {
    setBusy('sending')
    setFailure(null)
    try {
      await api.auth.sendEmailCode(to)
      setSentTo(to)
      cooldown.start()
      return true
    } catch (error) {
      setFailure(errorMessage(error, 'Couldn’t send the code. Check your connection and try again.'))
      return false
    } finally {
      setBusy(null)
    }
  }

  function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const found = emailProblem(email)
    setProblem(found)
    if (found) {
      focusField(event.currentTarget, 'email')
      return
    }
    void sendCode(email.trim())
  }

  async function handleResend() {
    if (sentTo && (await sendCode(sentTo))) toast('New code sent', { tone: 'ok' })
  }

  async function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!sentTo) return
    const found = codeProblem(code)
    setProblem(found)
    if (found) {
      focusField(event.currentTarget, 'code')
      return
    }

    setBusy('verifying')
    setFailure(null)
    try {
      await api.auth.verifyEmailCode(sentTo, code)
    } catch (error) {
      setFailure(errorMessage(error, 'Couldn’t check the code. Check your connection and try again.'))
    } finally {
      setBusy(null)
    }
  }

  const alert = failure ? (
    <p role="alert" className="text-sm text-bad">
      {failure}
    </p>
  ) : null

  if (sentTo === null) {
    return (
      <form onSubmit={handleSend} noValidate className="space-y-5">
        <EmailField
          value={email}
          onChange={(value) => {
            onEmailChange(value)
            setProblem(null)
          }}
          error={problem}
        />
        <Button type="submit" variant="primary" size="lg" fullWidth loading={busy === 'sending'}>
          Send code
        </Button>
        {alert}
      </form>
    )
  }

  return (
    <form onSubmit={(event) => void handleVerify(event)} noValidate className="space-y-5">
      <p id={sentNoteId} className="text-base text-ash">
        We sent a 6-digit code to <span className="text-bone [overflow-wrap:anywhere]">{sentTo}</span>.
      </p>
      <Field label="Code" error={problem}>
        {(control) => (
          <Input
            {...control}
            aria-describedby={[sentNoteId, control['aria-describedby']].filter(Boolean).join(' ')}
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={CODE_LENGTH}
            autoFocus
            value={code}
            onChange={(event) => {
              setCode(digitsOnly(event.target.value))
              setProblem(null)
            }}
            onPaste={(event) => {
              // Left to the browser, maxLength would cut a pasted "123 456"
              // short before the space could be dropped.
              event.preventDefault()
              setCode(digitsOnly(event.clipboardData.getData('text')))
              setProblem(null)
            }}
            className="h-14 text-center indent-[0.4em] font-mono text-xl tracking-[0.4em]"
          />
        )}
      </Field>
      <Button type="submit" variant="primary" size="lg" fullWidth loading={busy === 'verifying'}>
        Verify code
      </Button>
      {alert}
      <Button
        variant="ghost"
        fullWidth
        disabled={cooldown.secondsLeft > 0}
        loading={busy === 'sending'}
        onClick={() => void handleResend()}
      >
        {cooldown.secondsLeft > 0 ? (
          <span className="tabular-nums">Send a new code in {cooldown.secondsLeft}s</span>
        ) : (
          'Send a new code'
        )}
      </Button>
    </form>
  )
}
