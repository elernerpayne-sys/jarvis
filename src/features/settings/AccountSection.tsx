import { useState } from 'react'

import { useAuth } from '@/app/AuthProvider'
import { api, errorMessage } from '@/services'
import { Button } from '@/components/ui/Button'
import { Section } from '@/components/ui/Page'
import { ConfirmDialog } from '@/components/ui/Sheet'
import { useToast } from '@/components/ui/Toast'

function SignOut() {
  const toast = useToast()
  const [asking, setAsking] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  async function signOut() {
    setSigningOut(true)
    try {
      // The sign-in screen takes over by itself once the session is gone.
      await api.auth.signOut()
    } catch (error) {
      toast(errorMessage(error, 'Couldn’t sign out. Check your connection and try again.'), { tone: 'bad' })
    } finally {
      setSigningOut(false)
      setAsking(false)
    }
  }

  return (
    <>
      <Button onClick={() => setAsking(true)}>Sign out</Button>
      <ConfirmDialog
        open={asking}
        title="Sign out of Jarvis?"
        body="Jarvis keeps answering calls and running tasks. You’ll need to sign in again to see them here."
        confirmLabel="Sign out"
        busy={signingOut}
        onConfirm={() => void signOut()}
        onCancel={() => setAsking(false)}
      />
    </>
  )
}

/** Who is signed in, and the way out. In demo mode there is no account. */
export function AccountSection() {
  const auth = useAuth()

  return (
    <Section title="Account">
      {api.mode === 'demo' ? (
        <p className="text-base text-ash">
          Demo mode. You are looking at sample data and nothing is saved. Connect your Jarvis backend to go live.
        </p>
      ) : (
        <div className="space-y-4">
          <p className="text-base text-ash">
            {auth.user?.email ? (
              <>
                Signed in as <span className="text-bone [overflow-wrap:anywhere]">{auth.user.email}</span>
              </>
            ) : (
              'Signed in.'
            )}
          </p>
          <SignOut />
        </div>
      )}
    </Section>
  )
}
