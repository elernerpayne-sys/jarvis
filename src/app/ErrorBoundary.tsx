import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

import { Button } from '@/components/ui/Button'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Keeps one broken screen from taking the whole app down.
 * Give it a `key` (the current path) to clear the error on navigation.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Screen crashed:', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" className="mx-auto flex w-full max-w-[45rem] flex-col items-start gap-4 px-5 py-16">
        <h1 className="font-voice text-2xl text-bone">This screen stopped working.</h1>
        <p className="text-base text-ash">
          Reload to try again. If it keeps happening, the details are in the browser console.
        </p>
        <Button variant="primary" size="lg" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    )
  }
}
