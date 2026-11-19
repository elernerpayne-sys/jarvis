import { createContext, useContext } from 'react'

import type { VoiceContextValue, VoiceController } from '@/features/voice/types'

function nothing() {}

/** Stands in until an engine is ready: every action does nothing. */
export const INERT_CONTROLLER: VoiceController = {
  status: 'idle',
  mode: 'listening',
  channel: null,
  transcript: [],
  error: null,
  muted: false,
  startVoice: nothing,
  stop: nothing,
  sendText: nothing,
  retry: nothing,
  typing: nothing,
  setMuted: nothing,
  clear: nothing,
  getVolume: () => 0,
}

/**
 * Outside a `<VoiceProvider>` (a screen rendered on its own in a test) the
 * panel shows "Getting ready…" and stays disabled instead of crashing.
 */
const WITHOUT_PROVIDER: VoiceContextValue = {
  controller: INERT_CONTROLLER,
  engine: 'loading',
  reloadEngine: nothing,
  needsNetwork: false,
}

export const VoiceContext = createContext<VoiceContextValue>(WITHOUT_PROVIDER)

export function useVoice(): VoiceContextValue {
  return useContext(VoiceContext)
}
