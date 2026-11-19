/**
 * Renders the Receptionist feature for a test. The test file mocks
 * `@/services` itself; this only supplies the providers the app wraps it in.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router'

import { ToastProvider } from '@/components/ui/Toast'
import Receptionist from '@/features/receptionist'

/**
 * Stands in for the browser around the screen: prints the current URL, and
 * offers the browser's Back button.
 */
function BrowserProbe() {
  const location = useLocation()
  const navigate = useNavigate()
  return (
    <>
      <output data-testid="location">{`${location.pathname}${location.search}`}</output>
      <button type="button" onClick={() => void navigate(-1)}>
        Browser back
      </button>
    </>
  )
}

/**
 * Renders the Receptionist feature as the app mounts it. Pass the URLs
 * visited so far, oldest first; the last one is where the test starts.
 */
export function renderReceptionist(...history: [string, ...string[]]) {
  const queryClient = new QueryClient({
    // No waiting between attempts for the hooks that retry once on their own.
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={history} initialIndex={history.length - 1}>
        <ToastProvider>
          <Routes>
            <Route path="/receptionist/*" element={<Receptionist />} />
          </Routes>
          <BrowserProbe />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
