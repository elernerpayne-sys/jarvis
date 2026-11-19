import type { VoiceSnapshot } from '@/features/voice/types'

/** What a conversation is doing right now, as the owner would put it. */
export type Presence = 'idle' | 'connecting' | 'listening' | 'muted' | 'speaking' | 'chatting'

export function presenceOf(
  voice: Pick<VoiceSnapshot, 'status' | 'mode' | 'channel' | 'muted'>,
): Presence {
  if (voice.status === 'connecting') return 'connecting'
  if (voice.status !== 'live') return 'idle'
  if (voice.channel === 'text') return 'chatting'
  if (voice.mode === 'speaking') return 'speaking'
  // "Listening" would be untrue while the microphone is off.
  return voice.muted ? 'muted' : 'listening'
}
