import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ComponentType, ReactNode } from 'react'

import { useAuth } from '@/app/AuthProvider'
import { holdUpdates } from '@/lib/updates'
import { api } from '@/services'
import { INERT_CONTROLLER, VoiceContext } from '@/features/voice/context'
import { useDemoEngine } from '@/features/voice/demo/useDemoEngine'
import type {
  EngineProps,
  EngineState,
  VoiceContextValue,
  VoiceController,
} from '@/features/voice/types'

type EngineComponent = ComponentType<EngineProps>
export type EngineLoader = () => Promise<{ default: EngineComponent }>

/** The ElevenLabs SDK is about 165 kB gzipped, so it lives in its own chunk. */
const loadElevenLabsEngine: EngineLoader = () => import('@/features/voice/elevenlabs/ElevenLabsEngine')

function nothing() {}

/**
 * The installed app reloads itself into a new version at a quiet moment.
 * A conversation that is opening or live is never a quiet moment.
 */
function useHoldUpdatesWhile(busy: boolean) {
  useEffect(() => (busy ? holdUpdates() : undefined), [busy])
}

function isBusy(controller: VoiceController | null): boolean {
  return controller?.status === 'connecting' || controller?.status === 'live'
}

/**
 * Runs `task` once the browser has painted and has a moment to spare.
 * Returns a way to call it off.
 */
function whenIdle(task: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(task, { timeout: 1500 })
    return () => cancelIdleCallback(handle)
  }
  const timer = setTimeout(task, 200)
  return () => clearTimeout(timer)
}

/**
 * Talk to Jarvis, for every screen. Mounted once above the router so a
 * conversation carries on while the owner moves between tabs.
 *
 * Demo mode gets a scripted stand-in and never downloads the SDK. Live mode
 * talks to the owner's ElevenLabs agent.
 */
export function VoiceProvider({ children }: { children: ReactNode }) {
  // `api.mode` is fixed for the life of the page, so this never swaps.
  return api.mode === 'demo' ? (
    <DemoVoiceProvider>{children}</DemoVoiceProvider>
  ) : (
    <LiveVoiceProvider>{children}</LiveVoiceProvider>
  )
}

function DemoVoiceProvider({ children }: { children: ReactNode }) {
  const controller = useDemoEngine()
  useHoldUpdatesWhile(isBusy(controller))
  const value = useMemo<VoiceContextValue>(
    () => ({ controller, engine: 'ready', reloadEngine: nothing, needsNetwork: false }),
    [controller],
  )
  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>
}

/**
 * Loads the engine right after first paint rather than on the first tap:
 * the SDK's audio unlock for iPhone works by catching a tap, so it has to
 * be in place before the owner can press Talk.
 *
 * The engine is rendered beside `children`, not around them, and publishes
 * its controller upward. Nothing below remounts when it arrives.
 */
export function LiveVoiceProvider({
  children,
  load = loadElevenLabsEngine,
}: {
  children: ReactNode
  /** Swapped out in tests. */
  load?: EngineLoader
}) {
  const auth = useAuth()
  const [Engine, setEngine] = useState<EngineComponent | null>(null)
  const [controller, setController] = useState<VoiceController | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useHoldUpdatesWhile(isBusy(controller))

  useEffect(() => {
    let wanted = true
    const fetchEngine = () => {
      load().then(
        (module) => {
          if (wanted) setEngine(() => module.default)
        },
        () => {
          if (wanted) setFailed(true)
        },
      )
    }
    // The first load waits for a quiet moment; a retry was asked for, so it goes now.
    let cancel = nothing
    if (attempt === 0) cancel = whenIdle(fetchEngine)
    else fetchEngine()
    return () => {
      wanted = false
      cancel()
    }
  }, [load, attempt])

  const reloadEngine = useCallback(() => {
    setFailed(false)
    setAttempt((count) => count + 1)
  }, [])

  const engine: EngineState = controller ? 'ready' : failed ? 'failed' : 'loading'
  const value = useMemo<VoiceContextValue>(
    () => ({ controller: controller ?? INERT_CONTROLLER, engine, reloadEngine, needsNetwork: true }),
    [controller, engine, reloadEngine],
  )

  return (
    <VoiceContext.Provider value={value}>
      {children}
      {Engine ? <Engine userId={auth.user?.id} onController={setController} /> : null}
    </VoiceContext.Provider>
  )
}
