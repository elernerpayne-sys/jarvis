import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ServiceError } from '@/services/errors'
import {
  cannotStartReason,
  describeDisconnect,
  describeStartFailure,
  isOverrideRefusal,
} from '@/features/voice/elevenlabs/errors'
import { VOICE_MESSAGE } from '@/features/voice/messages'

/** What the SDK throws when the socket closes during the handshake. */
function connectionError(closeCode?: number, closeReason?: string): Error {
  return Object.assign(new Error(closeReason ?? 'Connection closed unexpectedly.'), {
    name: 'SessionConnectionError',
    closeCode,
    closeReason,
  })
}

function setMicrophoneApi(present: boolean) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: present ? { getUserMedia: vi.fn() } : undefined,
  })
}

describe('voice failure messages', () => {
  beforeEach(() => {
    setMicrophoneApi(true)
  })

  afterEach(() => {
    setMicrophoneApi(false)
  })

  it('shows the service layer’s own sentence, such as missing keys', () => {
    const missing = new ServiceError('not_configured', 'ElevenLabs is not set up yet. Add its keys in Supabase.')
    expect(describeStartFailure(missing, 'voice')).toBe('ElevenLabs is not set up yet. Add its keys in Supabase.')
  })

  it.each([
    ['NotAllowedError', VOICE_MESSAGE.micBlocked],
    ['SecurityError', VOICE_MESSAGE.micBlocked],
    ['NotFoundError', VOICE_MESSAGE.micMissing],
    ['NotReadableError', VOICE_MESSAGE.micBusy],
  ])('recognises the browser’s %s', (name, sentence) => {
    expect(describeStartFailure(new DOMException('raw browser text', name), 'voice')).toBe(sentence)
  })

  it('uses the exact wording for a blocked microphone', () => {
    expect(VOICE_MESSAGE.micBlocked).toBe(
      'Microphone access is blocked. Allow it in your browser settings, then try again.',
    )
  })

  it('explains that voice needs https when the page has no microphone API', () => {
    setMicrophoneApi(false)
    expect(cannotStartReason('voice')).toBe('Voice needs a secure connection. Open Jarvis over https.')
    // Typing needs no microphone, so it is not held back.
    expect(cannotStartReason('text')).toBeNull()
    expect(describeStartFailure(new TypeError('Cannot read properties of undefined'), 'voice')).toBe(
      VOICE_MESSAGE.insecure,
    )
  })

  it('says so when the device is offline', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    expect(cannotStartReason('voice')).toBe(VOICE_MESSAGE.offline)
    expect(cannotStartReason('text')).toBe(VOICE_MESSAGE.offline)
    expect(describeStartFailure(connectionError(1006), 'voice')).toBe(VOICE_MESSAGE.offline)
  })

  it('reads a refused typed start as the text-only override being off', () => {
    expect(describeStartFailure(connectionError(1008, 'Policy violation'), 'text')).toBe(
      VOICE_MESSAGE.textDisabled,
    )
    expect(describeStartFailure(connectionError(1011, 'Override text_only is not allowed'), 'text')).toBe(
      VOICE_MESSAGE.textDisabled,
    )
  })

  it('does not blame the override for a network drop, or for a spoken start', () => {
    expect(describeStartFailure(connectionError(1006), 'text')).toBe(VOICE_MESSAGE.unreachable)
    expect(describeStartFailure(connectionError(1008, 'Policy violation'), 'voice')).toBe(
      VOICE_MESSAGE.unreachable,
    )
  })

  it('never shows raw text for something it does not recognise', () => {
    expect(describeStartFailure(new Error('ECONNRESET at Object.<anonymous>'), 'voice')).toBe(
      VOICE_MESSAGE.unknown,
    )
    expect(describeStartFailure(undefined, 'text')).toBe(VOICE_MESSAGE.unknown)
  })

  it('treats hanging up as normal and a broken connection as a drop', () => {
    expect(describeDisconnect({ reason: 'user' }, 'voice')).toBeNull()
    expect(describeDisconnect({ reason: 'agent', context: { type: 'end_call' } }, 'voice')).toBeNull()
    expect(
      describeDisconnect({ reason: 'error', message: 'socket closed', context: { type: 'close' } }, 'voice'),
    ).toBe('The connection to Jarvis dropped.')
    expect(
      describeDisconnect({ reason: 'error', message: 'too long', context: { type: 'max_duration_exceeded' } }, 'voice'),
    ).toBe(VOICE_MESSAGE.timeLimit)
  })

  it('spots the agent refusing an override mid-conversation', () => {
    expect(isOverrideRefusal({ errorType: 'override_error' })).toBe(true)
    expect(isOverrideRefusal({ errorType: 'llm_error' })).toBe(false)
    expect(isOverrideRefusal(undefined)).toBe(false)
  })
})
