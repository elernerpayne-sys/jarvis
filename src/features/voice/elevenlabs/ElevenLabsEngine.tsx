/**
 * The real engine: a conversation with the owner's ElevenLabs agent.
 *
 * This file is the only place the SDK is imported, and it is loaded on
 * demand (never in demo mode), so the SDK stays out of the main bundle. It
 * renders nothing: `<Bridge>` turns the SDK's hooks into a `VoiceController`
 * and hands it up to `<VoiceProvider>`.
 *
 * Written against @elevenlabs/react 1.23:
 * - `ConversationProvider` is required around `useConversation`.
 * - `startSession` / `endSession` return nothing; progress arrives through
 *   callbacks.
 * - The SDK's own `status` turns "error" on errors that do not end the call,
 *   so "is a conversation live" comes from `useRawConversation()` instead.
 * - `onMessage` delivers finished turns only.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ConversationProvider, useConversation, useRawConversation } from '@elevenlabs/react'
import type { DisconnectionDetails, MessagePayload } from '@elevenlabs/react'

import { api } from '@/services'
import {
  cannotStartReason,
  describeDisconnect,
  describeStartFailure,
  isOverrideRefusal,
} from '@/features/voice/elevenlabs/errors'
import { VOICE_MESSAGE } from '@/features/voice/messages'
import { appendLine, correctJarvisLine, createEchoFilter } from '@/features/voice/transcript'
import type {
  EngineProps,
  TranscriptLine,
  VoiceChannel,
  VoiceController,
  VoiceStatus,
} from '@/features/voice/types'

/**
 * A typed conversation asks for no permission, so it should connect within
 * seconds. A spoken one may sit behind the microphone prompt for as long as
 * the owner takes, so only typed starts are timed.
 */
export const TEXT_CONNECT_TIMEOUT_MS = 20_000

/** Mounted once, beside the app. Unmounting it hangs up. */
export default function ElevenLabsEngine(props: EngineProps) {
  return (
    <ConversationProvider>
      <Bridge {...props} />
    </ConversationProvider>
  )
}

function Bridge({ userId, onController }: EngineProps) {
  // No `micMuted` / `volume` props: the hook applies them in an effect, and
  // both throw in a text-only conversation.
  const sdk = useConversation()
  const conversation = useRawConversation()
  const liveChannel: VoiceChannel | null = conversation
    ? conversation.type === 'text'
      ? 'text'
      : 'voice'
    : null

  /** The channel being opened: from the tap until the agent answers. */
  const [opening, setOpening] = useState<VoiceChannel | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<TranscriptLine[]>([])

  const status: VoiceStatus = liveChannel ? 'live' : opening ? 'connecting' : failure ? 'error' : 'idle'
  const channel = liveChannel ?? opening

  // Callbacks outlive the render that created them; they read the newest
  // SDK handle, user and state through this ref.
  const latest = useRef({ sdk, userId, status, channel })
  useEffect(() => {
    latest.current = { sdk, userId, status, channel }
  })

  /** Bumped by every start and stop. Callbacks from an older attempt are ignored. */
  const attemptRef = useRef(0)
  /** True between the current attempt's connect and its disconnect. */
  const connectedRef = useRef(false)
  /** What "Try again" repeats. */
  const lastChannelRef = useRef<VoiceChannel>('voice')
  /** Typed messages waiting for a conversation to connect. */
  const outboxRef = useRef<string[]>([])
  const echoRef = useRef(createEchoFilter())
  const lineCountRef = useRef(0)
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current) clearTimeout(watchdogRef.current)
    watchdogRef.current = null
  }, [])

  const addLine = useCallback((role: TranscriptLine['role'], text: string) => {
    const clean = text.trim()
    if (!clean) return
    lineCountRef.current += 1
    const line: TranscriptLine = { id: `line-${lineCountRef.current}`, role, text: clean, at: Date.now() }
    setTranscript((lines) => appendLine(lines, line))
  }, [])

  const fail = useCallback(
    (message: string) => {
      clearWatchdog()
      connectedRef.current = false
      setOpening(null)
      setFailure(message)
    },
    [clearWatchdog],
  )

  const flushOutbox = useCallback(() => {
    const outbox = outboxRef.current
    try {
      for (let text = outbox[0]; text !== undefined; text = outbox[0]) {
        latest.current.sdk.sendUserMessage(text)
        outbox.shift()
      }
    } catch {
      // The conversation closed again before it could take them. What is
      // left stays queued for the next attempt.
    }
  }, [])

  /**
   * Opens a conversation. Only ever called from a tap or a submit: starting
   * from an effect would open two sockets under StrictMode, and browsers
   * want a gesture before they play audio.
   */
  const open = useCallback(
    (wanted: VoiceChannel) => {
      const attempt = ++attemptRef.current
      const isCurrent = () => attempt === attemptRef.current
      clearWatchdog()
      connectedRef.current = false
      lastChannelRef.current = wanted
      setFailure(null)
      // Hangs up the other kind of conversation if one is live. Its last
      // callbacks carry an older attempt number and are ignored.
      latest.current.sdk.endSession()

      const blocker = cannotStartReason(wanted)
      if (blocker) {
        fail(blocker)
        return
      }

      setOpening(wanted)
      // A signed URL is good for one conversation, so each start asks the
      // service layer (an edge function) for a fresh one.
      api.getVoiceSession().then(
        (session) => {
          if (!isCurrent()) return // cancelled while the URL was on its way
          const { sdk: current, userId: user } = latest.current
          current.startSession({
            signedUrl: session.signed_url,
            textOnly: wanted === 'text',
            ...(user ? { userId: user } : {}),
            onConnect: () => {
              if (!isCurrent()) return
              clearWatchdog()
              connectedRef.current = true
              setOpening(null)
              flushOutbox()
            },
            onDisconnect: (details: DisconnectionDetails) => {
              if (!isCurrent()) return
              clearWatchdog()
              connectedRef.current = false
              setOpening(null)
              // The owner or Jarvis hanging up is not an error.
              const problem = describeDisconnect(details, wanted)
              if (problem) setFailure(problem)
              else outboxRef.current = []
            },
            onMessage: ({ role, message }: MessagePayload) => {
              if (!isCurrent()) return
              // A typed message is already on screen; skip the agent's copy of it.
              if (role === 'user' && echoRef.current.isEcho(message)) return
              addLine(role === 'user' ? 'you' : 'jarvis', message)
            },
            onAgentResponseCorrection: ({ original_agent_response, corrected_agent_response }) => {
              if (!isCurrent()) return
              setTranscript((lines) =>
                correctJarvisLine(lines, original_agent_response, corrected_agent_response),
              )
            },
            onError: (_message: string, context?: unknown) => {
              if (!isCurrent()) return
              if (!connectedRef.current) {
                // The start itself failed; `context` is whatever was thrown.
                fail(describeStartFailure(context, wanted))
                return
              }
              // Still connected: most errors here are not fatal. This one is,
              // because the agent will never answer a typed message.
              if (wanted === 'text' && isOverrideRefusal(context)) {
                attemptRef.current += 1
                current.endSession()
                fail(VOICE_MESSAGE.textDisabled)
              }
            },
          })

          if (wanted === 'text') {
            watchdogRef.current = setTimeout(() => {
              if (!isCurrent() || connectedRef.current) return
              attemptRef.current += 1
              latest.current.sdk.endSession()
              fail(VOICE_MESSAGE.noAnswer)
            }, TEXT_CONNECT_TIMEOUT_MS)
          }
        },
        (cause: unknown) => {
          if (isCurrent()) fail(describeStartFailure(cause, wanted))
        },
      )
    },
    [addLine, clearWatchdog, fail, flushOutbox],
  )

  const startVoice = useCallback(() => {
    const now = latest.current
    const busy = now.status === 'connecting' || now.status === 'live'
    if (busy && now.channel === 'voice') return
    open('voice')
  }, [open])

  const stop = useCallback(() => {
    // Drops a signed URL that is still on its way and silences the ending
    // conversation's callbacks; the state is settled right here instead.
    attemptRef.current += 1
    clearWatchdog()
    connectedRef.current = false
    outboxRef.current = []
    setOpening(null)
    latest.current.sdk.endSession()
  }, [clearWatchdog])

  const sendText = useCallback(
    (raw: string) => {
      const text = raw.trim()
      if (!text) return
      echoRef.current.remember(text)
      addLine('you', text)

      if (connectedRef.current) {
        try {
          // In a spoken conversation Jarvis answers this aloud.
          latest.current.sdk.sendUserMessage(text)
          return
        } catch {
          // The conversation ended a moment ago; start a typed one below.
          connectedRef.current = false
        }
      }
      outboxRef.current.push(text)
      // Already connecting? The message goes out as soon as that connects.
      if (latest.current.status !== 'connecting') open('text')
    },
    [addLine, open],
  )

  const retry = useCallback(() => open(lastChannelRef.current), [open])

  const typing = useCallback(() => {
    if (!connectedRef.current) return
    try {
      latest.current.sdk.sendUserActivity()
    } catch {
      // The conversation just ended; nothing to tell.
    }
  }, [])

  const setMuted = useCallback((muted: boolean) => {
    const now = latest.current
    if (now.status !== 'live' || now.channel !== 'voice') return
    try {
      now.sdk.setMuted(muted)
    } catch {
      // The conversation just ended; the SDK resets mute by itself.
    }
  }, [])

  const clear = useCallback(() => {
    // A message that is no longer on screen should not be sent later.
    if (!connectedRef.current) outboxRef.current = []
    echoRef.current.reset()
    setTranscript([])
  }, [])

  // Both getters are safe every frame and read 0 when nothing is live.
  const getVolume = useCallback(() => {
    const { getInputVolume, getOutputVolume } = latest.current.sdk
    return Math.max(getInputVolume(), getOutputVolume())
  }, [])

  const mode = liveChannel === 'voice' ? sdk.mode : 'listening'
  const muted = liveChannel === 'voice' && sdk.isMuted

  const controller = useMemo<VoiceController>(
    () => ({
      status,
      mode,
      channel,
      transcript,
      error: status === 'error' ? failure : null,
      muted,
      startVoice,
      stop,
      sendText,
      retry,
      typing,
      setMuted,
      clear,
      getVolume,
    }),
    [status, mode, channel, transcript, failure, muted, startVoice, stop, sendText, retry, typing, setMuted, clear, getVolume],
  )

  useEffect(() => {
    onController(controller)
  }, [controller, onController])

  useEffect(
    () => () => {
      // The provider hangs up on unmount; make sure nothing answers afterwards.
      attemptRef.current += 1
      clearWatchdog()
      onController(null)
    },
    [clearWatchdog, onController],
  )

  return null
}
