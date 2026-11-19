import type { ReactNode } from 'react'

export type * from '@/features/voice/types'

/** Placeholder: replaced by the real voice feature. */
export function VoiceProvider({ children }: { children: ReactNode }) {
  return <>{children}</>
}

/** Placeholder: the Talk to Jarvis hero. */
export function TalkPanel() {
  return <p className="text-ash">Talk to Jarvis is not built yet.</p>
}

/** Placeholder: the floating "conversation in progress" pill. */
export function VoicePill() {
  return null
}
