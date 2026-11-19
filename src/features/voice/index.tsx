/**
 * Talk to Jarvis: a live conversation with the owner's voice agent.
 *
 * - `<VoiceProvider>` goes once above the router and owns the conversation.
 * - `<TalkPanel>` is the hero on Home: the button, the transcript, typing.
 * - `<VoicePill>` floats on every other screen while a conversation is live.
 */
export type * from '@/features/voice/types'

export { VoiceProvider } from '@/features/voice/VoiceProvider'
export { TalkPanel } from '@/features/voice/TalkPanel'
export { VoicePill } from '@/features/voice/VoicePill'
