import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { api } from '@/services'
import type { AuthUser } from '@/services'

export type AuthState =
  | { status: 'loading'; user: null }
  | { status: 'signed_out'; user: null }
  | { status: 'signed_in'; user: AuthUser }

const AuthContext = createContext<AuthState>({ status: 'loading', user: null })

/** Who is signed in. In demo mode this is always the sample owner. */
export function useAuth(): AuthState {
  return useContext(AuthContext)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null })
  const queryClient = useQueryClient()

  useEffect(() => {
    let active = true
    const apply = (user: AuthUser | null) => {
      if (!active) return
      setState((current) => {
        if (user) {
          // Token refreshes re-announce the same user; keep the same object.
          if (current.status === 'signed_in' && current.user.id === user.id) return current
          return { status: 'signed_in', user }
        }
        return current.status === 'signed_out' ? current : { status: 'signed_out', user: null }
      })
    }
    const unsubscribe = api.auth.onChange(apply)
    api.auth.getUser().then(apply, () => apply(null))
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  // Nothing fetched for one session may be shown to the next.
  const signedOut = state.status === 'signed_out'
  useEffect(() => {
    if (signedOut) queryClient.clear()
  }, [signedOut, queryClient])

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}
