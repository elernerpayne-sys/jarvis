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

/** Everything about a conversation that the UI renders. */
export interface VoiceSnapshot {
  status: VoiceStatus
  mode: VoiceMode
  /** The conversation being opened or held. Null while idle or after an error. */
  channel: VoiceChannel | null
  /** Oldest first. Kept after the conversation ends, until `clear()`. */
  transcript: TranscriptLine[]
  /** A sentence for the owner. Set exactly when `status` is "error". */
  error: string | null
  /** Only ever true in a spoken conversation. */
  muted: boolean
}

export interface VoiceController extends VoiceSnapshot {
  /**
   * Starts a spoken conversation, asking for the microphone if needed. Ends a
   * typed conversation first. Does nothing if one is already starting or live.
   */
  startVoice(): void
  /** Ends the conversation, spoken or typed. Safe to call when idle. */
  stop(): void
  /**
   * Sends a typed message. If no conversation is live it starts a text-only
   * one first (no microphone) and sends the message as soon as it connects.
   * In a spoken conversation Jarvis answers aloud.
   */
  sendText(text: string): void
  /** Repeats the attempt that failed, spoken or typed. */
  retry(): void
  /** Tells Jarvis the owner is typing, so it holds its next line for a moment. */
  typing(): void
  /** Spoken conversations only; ignored otherwise. */
  setMuted(muted: boolean): void
  /** Empties the transcript. */
  clear(): void
  /**
   * Current loudness, 0 to 1: your microphone while Jarvis listens, Jarvis's
   * voice while it speaks. Speech sits well under 1. Cheap enough to call
   * every animation frame.
   */
  getVolume(): number
}

/**
 * - loading: the engine's code is still on its way
 * - ready: Talk can be pressed
 * - failed: the engine's code could not be loaded
 */
export type EngineState = 'loading' | 'ready' | 'failed'

/** What the Talk to Jarvis UI reads from `<VoiceProvider>`. */
export interface VoiceContextValue {
  controller: VoiceController
  engine: EngineState
  /** Tries to load the engine again after it failed. */
  reloadEngine(): void
  /** True when conversations go over the network (the real agent). */
  needsNetwork: boolean
}

/**
 * An engine that is loaded on demand renders nothing. It is mounted beside
 * the app, not around it, and hands its controller up through this callback.
 */
export interface EngineProps {
  /** The signed-in owner, passed to the agent as the conversation's user. */
  userId: string | undefined
  /** Called with the controller whenever it changes, and with null on unmount. */
  onController(controller: VoiceController | null): void
}
