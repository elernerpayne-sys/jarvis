import { Suspense, lazy, useState } from 'react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'

import { AuthProvider, useAuth } from '@/app/AuthProvider'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { RealtimeProvider } from '@/app/RealtimeProvider'
import { AppShell } from '@/components/layout/AppShell'
import { ToastProvider } from '@/components/ui/Toast'
import { VoiceProvider } from '@/features/voice'

// Each screen is its own chunk, so the phone only downloads what it opens.
const Home = lazy(() => import('@/features/home'))
const Receptionist = lazy(() => import('@/features/receptionist'))
const Code = lazy(() => import('@/features/code'))
const Memory = lazy(() => import('@/features/memory'))
const SettingsScreen = lazy(() => import('@/features/settings'))
const SignIn = lazy(() => import('@/features/auth'))

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Realtime keeps data fresh; this just avoids refetching on every mount.
        staleTime: 15_000,
        retry: 1,
        refetchOnWindowFocus: true,
      },
      mutations: { retry: 0 },
    },
  })
}

/** A blank, on-brand screen while we find out whether you are signed in. */
function Splash() {
  return (
    <div role="status" aria-label="Loading Jarvis" className="flex min-h-dvh items-center justify-center bg-ink">
      <span className="size-3 animate-pulse-dot rounded-full bg-amber" />
    </div>
  )
}

/** Nothing below this renders until the owner is signed in. */
function SignedIn({ children }: { children: ReactNode }) {
  const auth = useAuth()
  if (auth.status === 'loading') return <Splash />
  if (auth.status === 'signed_out') {
    return (
      <Suspense fallback={<Splash />}>
        <SignIn />
      </Suspense>
    )
  }
  return <>{children}</>
}

export default function App() {
  const [queryClient] = useState(createQueryClient)

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ToastProvider>
            <AuthProvider>
              <SignedIn>
                <RealtimeProvider>
                  <VoiceProvider>
                    <Routes>
                      <Route element={<AppShell />}>
                        <Route index element={<Home />} />
                        <Route path="receptionist/*" element={<Receptionist />} />
                        <Route path="code/*" element={<Code />} />
                        <Route path="memory/*" element={<Memory />} />
                        <Route path="settings/*" element={<SettingsScreen />} />
                        <Route path="*" element={<Navigate to="/" replace />} />
                      </Route>
                    </Routes>
                  </VoiceProvider>
                </RealtimeProvider>
              </SignedIn>
            </AuthProvider>
          </ToastProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}