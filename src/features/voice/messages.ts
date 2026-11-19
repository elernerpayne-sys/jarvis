/**
 * Every sentence the owner can be shown when Talk to Jarvis can't do what
 * was asked. One place, so the wording stays consistent and plain.
 */
export const VOICE_MESSAGE = {
  engineFailed: 'Couldn’t load voice. Check your connection.',
  micBlocked: 'Microphone access is blocked. Allow it in your browser settings, then try again.',
  micMissing: 'No microphone was found. Plug one in or check your device settings, then try again.',
  micBusy: 'The microphone couldn’t be used. Another app may be holding it. Close that app, then try again.',
  insecure: 'Voice needs a secure connection. Open Jarvis over https.',
  offline: 'You’re offline. Voice needs a connection.',
  dropped: 'The connection to Jarvis dropped.',
  timeLimit: 'That conversation reached its time limit. Start a new one to keep going.',
  unreachable: 'Couldn’t reach Jarvis. Check your connection and try again.',
  noAnswer: 'Jarvis didn’t answer. Check your connection and try again.',
  textDisabled:
    'Typed chat isn’t switched on for your ElevenLabs agent yet. Enable the text-only override in the agent’s Security settings.',
  unknown: 'Couldn’t start the conversation. Try again.',
} as const
