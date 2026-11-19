import { useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { CodeForm } from '@/features/auth/CodeForm'
import { PasswordForm } from '@/features/auth/PasswordForm'

type Method = 'password' | 'code'

/**
 * The only screen a signed-out visitor can reach. There is one account, the
 * owner's, so there is no sign-up and nothing here links anywhere else.
 */
export default function SignIn() {
  const [method, setMethod] = useState<Method>('password')
  // Held here so switching between password and code keeps what was typed.
  const [email, setEmail] = useState('')

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center bg-ink px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))] text-bone">
      <h1 className="font-voice text-3xl">Jarvis</h1>
      <p className="mt-2 text-base text-ash">Sign in to your command center.</p>

      <Card className="mt-8">
        {method === 'password' ? (
          <PasswordForm email={email} onEmailChange={setEmail} />
        ) : (
          <CodeForm email={email} onEmailChange={setEmail} />
        )}
      </Card>

      <Button
        variant="ghost"
        fullWidth
        className="mt-2"
        onClick={() => setMethod(method === 'password' ? 'code' : 'password')}
      >
        {method === 'password' ? 'Email me a sign-in code instead' : 'Use a password instead'}
      </Button>

      <p className="mt-8 text-center text-sm text-smoke">This is a private app. There is no sign-up.</p>
    </main>
  )
}
