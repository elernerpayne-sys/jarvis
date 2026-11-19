/**
 * The contract between the Talk to Jarvis UI and whatever is on the other
 * end. Two engines implement it: the ElevenLabs agent (live mode) and a
 * scripted stand-in (demo mode). The UI only ever sees `VoiceController`.
 */

/**
 * - idle: no conversation
 * - connecting: asking for the microphone / opening the session
 * - live: connected to Jarvis
 * - error: the last attempt failed; `error` says why
 */
export type VoiceStatus = 'idle' | 'connecting' | 'live' | 'error'

/** While live: whose turn it is. */
export type VoiceMode = 'listening' | 'speaking'

/** How the current conversation is being held. */
export type VoiceChannel = 'voice' | 'text'

export interface TranscriptLine {
  id: string
  role: 'you' | 'jarvis'
  text: string
  /** Epoch milliseconds. */
  at: number
}

export interface VoiceController {
  status: VoiceStatus
  mode: VoiceMode
  /** Null while idle. */
  channel: VoiceChannel | null
  /** Oldest first. Kept after the conversation ends, until `clear()`. */
  transcript: TranscriptLine[]
  /** A sentence for the owner when `status` is "error". */
  error: string | null
  muted: boolean
  /** Starts a spoken conversation. Asks for the microphone if needed. */
  startVoice(): Promise<void>
  /** Ends the conversation, spoken or typed. Safe to call when idle. */
  stop(): Promise<void>
  /**
   * Sends a typed message. If no conversation is live it starts a text-only
   * one first (no microphone). Works during a spoken conversation too.
   */
  sendText(text: string): Promise<void>
  setMuted(muted: boolean): void
  /** Empties the transcript. */
  clear(): void
  /**
   * Current loudness, 0 to 1: your microphone while Jarvis listens, Jarvis's
   * voice while it speaks. Cheap enough to call every animation frame.
   */
  getVolume(): number
}
