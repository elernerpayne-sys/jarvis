import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import { api } from '@/services'
import { createDemoEngine } from '@/features/voice/demo/demoEngine'
import { openMicMeter } from '@/features/voice/demo/micMeter'
import type { VoiceController } from '@/features/voice/types'

function nothing() {}

/** The demo engine as a `VoiceController`, fed by the app's own service layer. */
export function useDemoEngine(): VoiceController {
  const [engine] = useState(() => createDemoEngine({ source: api, openMic: openMicMeter }))
  const snapshot = useSyncExternalStore(engine.subscribe, engine.getState)

  // Leaving the app (or signing out) hangs up and lets go of the microphone.
  useEffect(() => () => engine.stop(), [engine])

  return useMemo(
    () => ({
      ...snapshot,
      startVoice: engine.startVoice,
      stop: engine.stop,
      sendText: engine.sendText,
      // The demo never fails, so there is nothing to repeat but a fresh start.
      retry: engine.startVoice,
      typing: nothing,
      setMuted: engine.setMuted,
      clear: engine.clear,
      getVolume: engine.getVolume,
    }),
    [engine, snapshot],
  )
}
