/**
 * Turns everything that can go wrong with a conversation into one plain
 * sentence for the owner. Raw SDK and browser messages never reach the
 * screen when the case can be recognised.
 *
 * Nothing here imports the SDK: failures are recognised by their shape,
 * which keeps this file easy to test.
 */
import { isServiceError } from '@/services/errors'
import { VOICE_MESSAGE } from '@/features/voice/messages'
import type { VoiceChannel } from '@/features/voice/types'

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

/** The microphone API only exists on a secure page (https or localhost). */
function hasMicrophoneApi(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function'
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined
}

/** Reasons we can rule out before asking for a session at all. */
export function cannotStartReason(channel: VoiceChannel): string | null {
  if (channel === 'voice' && !hasMicrophoneApi()) return VOICE_MESSAGE.insecure
  if (isOffline()) return VOICE_MESSAGE.offline
  return null
}

const TEXT_OVERRIDE = /override|text[\s_-]?only/i

/**
 * Whether a refused handshake looks like the agent turning down the
 * text-only override. Best effort: ElevenLabs does not document how that
 * refusal arrives. The URL is freshly signed, so a deliberate close (as
 * opposed to a network drop, code 1006) most likely means the override is
 * off.
 */
function looksLikeTextRefusal(cause: unknown): boolean {
  const reason = field(cause, 'closeReason')
  if (typeof reason === 'string' && TEXT_OVERRIDE.test(reason)) return true
  const code = field(cause, 'closeCode')
  if (typeof code !== 'number') return false
  return [1000, 1002, 1003, 1007, 1008].includes(code) || (code >= 3000 && code <= 4999)
}

/**
 * Why a conversation failed to start. `cause` is whatever was thrown: a
 * `ServiceError` from fetching the signed URL, the browser's `DOMException`
 * from the microphone prompt, or the SDK's connection error.
 */
export function describeStartFailure(cause: unknown, channel: VoiceChannel): string {
  // The service layer already writes for the owner (for example, missing keys).
  if (isServiceError(cause)) return cause.message

  switch (field(cause, 'name')) {
    case 'NotAllowedError':
    case 'SecurityError':
      return VOICE_MESSAGE.micBlocked
    case 'NotFoundError':
    case 'OverconstrainedError':
      return VOICE_MESSAGE.micMissing
    case 'NotReadableError':
    case 'AbortError':
      return VOICE_MESSAGE.micBusy
    case 'SessionConnectionError':
      if (isOffline()) return VOICE_MESSAGE.offline
      return channel === 'text' && looksLikeTextRefusal(cause)
        ? VOICE_MESSAGE.textDisabled
        : VOICE_MESSAGE.unreachable
  }

  if (channel === 'voice' && !hasMicrophoneApi()) return VOICE_MESSAGE.insecure
  if (isOffline()) return VOICE_MESSAGE.offline
  return VOICE_MESSAGE.unknown
}

/** The shape of the SDK's `onDisconnect` payload that matters here. */
export interface Disconnection {
  reason: 'error' | 'agent' | 'user'
  message?: string
  context?: { type?: string }
}

/**
 * Why a live conversation ended, or null when it ended normally (the owner
 * or Jarvis hung up).
 */
export function describeDisconnect(details: Disconnection, channel: VoiceChannel): string | null {
  if (details.reason !== 'error') return null
  if (details.context?.type === 'max_duration_exceeded') return VOICE_MESSAGE.timeLimit
  if (channel === 'text' && TEXT_OVERRIDE.test(details.message ?? '')) return VOICE_MESSAGE.textDisabled
  return VOICE_MESSAGE.dropped
}

/** A server error, mid-conversation, saying the agent refused an override. */
export function isOverrideRefusal(context: unknown): boolean {
  return field(context, 'errorType') === 'override_error'
}
