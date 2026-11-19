import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ServiceError } from '@/services/errors'
import ElevenLabsEngine, { TEXT_CONNECT_TIMEOUT_MS } from '@/features/voice/elevenlabs/ElevenLabsEngine'
import { VOICE_MESSAGE } from '@/features/voice/messages'
import type { VoiceController } from '@/features/voice/types'

/**
 * A stand-in for @elevenlabs/react. The real SDK cannot run under vitest
 * (its browser entry is not what Node resolves), so the tests drive this one
 * the way the SDK drives the app: through the callbacks given to
 * `startSession`.
 */
const sdk = vi.hoisted(() => {
  interface State {
    conversation: { type: 'voice' | 'text' } | null
    mode: 'listening' | 'speaking'
    isMuted: boolean
  }
  const listeners = new Set<() => void>()
  let state: State = { conversation: null, mode: 'listening', isMuted: false }
  return {
    volume: { input: 0, output: 0 },
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(patch: Partial<State>) {
      state = { ...state, ...patch }
      for (const listener of listeners) listener()
    },
    startSession: vi.fn(),
    endSession: vi.fn(),
    sendUserMessage: vi.fn(),
    sendUserActivity: vi.fn(),
    setMuted: vi.fn(),
  }
})

vi.mock('@elevenlabs/react', async () => {
  const { useSyncExternalStore } = await import('react')
  const useSdkState = () => useSyncExternalStore(sdk.subscribe, sdk.getState)
  return {
    ConversationProvider: ({ children }: { children: unknown }) => children,
    useRawConversation: () => useSdkState().conversation,
    useConversation: () => {
      const { mode, isMuted } = useSdkState()
      return {
        mode,
        isMuted,
        startSession: sdk.startSession,
        endSession: sdk.endSession,
        sendUserMessage: sdk.sendUserMessage,
        sendUserActivity: sdk.sendUserActivity,
        setMuted: sdk.setMuted,
        getInputVolume: () => sdk.volume.input,
        getOutputVolume: () => sdk.volume.output,
      }
    },
  }
})

const getVoiceSession = vi.hoisted(() => vi.fn())

vi.mock('@/services', async () => {
  const errors = await vi.importActual<typeof import('@/services/errors')>('@/services/errors')
  return { ...errors, api: { mode: 'live', getVoiceSession } }
})

/** The callbacks the engine handed to the SDK for one session. */
interface Session {
  signedUrl: string
  textOnly: boolean
  userId?: string
  onConnect: (props: { conversationId: string }) => void
  onDisconnect: (details: { reason: string; message?: string; context?: { type?: string } }) => void
  onMessage: (payload: { role: 'user' | 'agent'; message: string }) => void
  onAgentResponseCorrection: (payload: {
    original_agent_response: string
    corrected_agent_response: string
  }) => void
  onError: (message: string, context?: unknown) => void
}

function session(index = -1): Session {
  const call = sdk.startSession.mock.calls.at(index)
  if (!call) throw new Error('startSession was not called.')
  return call[0] as Session
}

/** The SDK reports the session connected. */
function connect() {
  const current = session()
  act(() => {
    sdk.set({ conversation: { type: current.textOnly ? 'text' : 'voice' } })
    current.onConnect({ conversationId: 'conv_1' })
  })
}

/** The newest controller the engine published. */
let voice: VoiceController

function mountEngine() {
  const onController = vi.fn((controller: VoiceController | null) => {
    if (controller) voice = controller
  })
  const view = render(<ElevenLabsEngine userId="owner-1" onController={onController} />)
  return { ...view, onController }
}

/** Runs a controller action and lets the signed-URL request settle. */
async function press(action: () => void) {
  await act(async () => {
    action()
  })
}

function setMicrophoneApi(present: boolean) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: present ? { getUserMedia: vi.fn() } : undefined,
  })
}

function lines(): string[] {
  return voice.transcript.map((line) => `${line.role}: ${line.text}`)
}

describe('ElevenLabs engine', () => {
  let urlCount = 0

  beforeEach(() => {
    urlCount = 0
    sdk.set({ conversation: null, mode: 'listening', isMuted: false })
    sdk.volume = { input: 0, output: 0 }
    for (const mock of [sdk.startSession, sdk.sendUserMessage, sdk.sendUserActivity, sdk.setMuted]) {
      mock.mockReset()
    }
    // Like the real provider, hanging up releases the conversation at once.
    sdk.endSession.mockReset().mockImplementation(() => sdk.set({ conversation: null }))
    getVoiceSession.mockReset().mockImplementation(async () => {
      urlCount += 1
      return { signed_url: `wss://signed.example/${urlCount}` }
    })
    setMicrophoneApi(true)
  })

  afterEach(() => {
    setMicrophoneApi(false)
    vi.useRealTimers()
  })

  it('starts idle and publishes its controller', () => {
    const { onController } = mountEngine()
    expect(onController).toHaveBeenCalled()
    expect(voice).toMatchObject({ status: 'idle', channel: null, transcript: [], error: null, muted: false })
    expect(getVoiceSession).not.toHaveBeenCalled()
    expect(sdk.startSession).not.toHaveBeenCalled()
  })

  it('fetches a signed URL and starts a spoken session with it', async () => {
    mountEngine()

    await press(() => voice.startVoice())

    expect(getVoiceSession).toHaveBeenCalledTimes(1)
    expect(voice).toMatchObject({ status: 'connecting', channel: 'voice' })
    expect(sdk.startSession).toHaveBeenCalledTimes(1)
    expect(session()).toMatchObject({
      signedUrl: 'wss://signed.example/1',
      textOnly: false,
      userId: 'owner-1',
    })

    connect()
    expect(voice).toMatchObject({ status: 'live', channel: 'voice', mode: 'listening', error: null })
  })

  it('asks for a fresh signed URL every time', async () => {
    mountEngine()
    await press(() => voice.startVoice())
    connect()
    await press(() => voice.stop())
    await press(() => voice.startVoice())

    expect(getVoiceSession).toHaveBeenCalledTimes(2)
    expect(session().signedUrl).toBe('wss://signed.example/2')
  })

  it('ignores a second press while it is already connecting', async () => {
    mountEngine()
    await press(() => voice.startVoice())
    await press(() => voice.startVoice())
    expect(getVoiceSession).toHaveBeenCalledTimes(1)
    expect(sdk.startSession).toHaveBeenCalledTimes(1)
  })

  it('never opens a session when cancelled while the signed URL is on its way', async () => {
    let deliver: (value: { signed_url: string }) => void = () => {}
    getVoiceSession.mockImplementation(() => new Promise((resolve) => (deliver = resolve)))
    mountEngine()

    await press(() => voice.startVoice())
    expect(voice.status).toBe('connecting')
    await press(() => voice.stop())
    expect(voice.status).toBe('idle')

    await act(async () => deliver({ signed_url: 'wss://signed.example/late' }))
    expect(sdk.startSession).not.toHaveBeenCalled()
    expect(voice).toMatchObject({ status: 'idle', error: null })
  })

  it('tells the owner when the microphone is blocked', async () => {
    mountEngine()
    await press(() => voice.startVoice())

    act(() => session().onError('Permission denied', new DOMException('Permission denied', 'NotAllowedError')))

    expect(voice).toMatchObject({
      status: 'error',
      channel: null,
      error: 'Microphone access is blocked. Allow it in your browser settings, then try again.',
    })
  })

  it('shows the service’s own message when ElevenLabs is not configured', async () => {
    getVoiceSession.mockRejectedValue(
      new ServiceError('not_configured', 'ElevenLabs is not set up yet. Add its keys in Supabase.'),
    )
    mountEngine()

    await press(() => voice.startVoice())

    expect(voice).toMatchObject({
      status: 'error',
      error: 'ElevenLabs is not set up yet. Add its keys in Supabase.',
    })
    expect(sdk.startSession).not.toHaveBeenCalled()
  })

  it('explains that voice needs https, without asking for a session', async () => {
    setMicrophoneApi(false)
    mountEngine()

    await press(() => voice.startVoice())

    expect(voice).toMatchObject({
      status: 'error',
      error: 'Voice needs a secure connection. Open Jarvis over https.',
    })
    expect(getVoiceSession).not.toHaveBeenCalled()
  })

  it('collects finished turns from both sides, oldest first', async () => {
    mountEngine()
    await press(() => voice.startVoice())
    connect()

    act(() => {
      session().onMessage({ role: 'agent', message: 'Good evening. What do you need?' })
      session().onMessage({ role: 'user', message: 'What did I miss today?' })
      session().onMessage({ role: 'agent', message: 'Two calls, both at Fade Factory.' })
    })

    expect(lines()).toEqual([
      'jarvis: Good evening. What do you need?',
      'you: What did I miss today?',
      'jarvis: Two calls, both at Fade Factory.',
    ])
  })

  it('sends a typed message into a live spoken conversation and shows it once', async () => {
    mountEngine()
    await press(() => voice.startVoice())
    connect()

    await press(() => voice.sendText('  Any missed calls?  '))

    expect(sdk.sendUserMessage).toHaveBeenCalledWith('Any missed calls?')
    expect(getVoiceSession).toHaveBeenCalledTimes(1)
    expect(lines()).toEqual(['you: Any missed calls?'])

    // The agent echoes the typed message back as a transcript: not shown twice.
    act(() => session().onMessage({ role: 'user', message: 'Any missed calls?' }))
    expect(lines()).toEqual(['you: Any missed calls?'])

    // Saying the same words aloud afterwards is a new turn.
    act(() => session().onMessage({ role: 'user', message: 'Any missed calls?' }))
    expect(lines()).toEqual(['you: Any missed calls?', 'you: Any missed calls?'])
  })

  it('replaces what Jarvis was cut off saying', async () => {
    mountEngine()
    await press(() => voice.startVoice())
    connect()

    act(() => {
      session().onMessage({ role: 'agent', message: 'You had three calls today and two of them booked.' })
      session().onAgentResponseCorrection({
        original_agent_response: 'You had three calls today and two of them booked.',
        corrected_agent_response: 'You had three calls today',
      })
    })

    expect(lines()).toEqual(['jarvis: You had three calls today'])
  })

  it('starts a text-only session for a message typed while idle, then sends it', async () => {
    // No microphone API at all: typing must still work.
    setMicrophoneApi(false)
    mountEngine()

    await press(() => voice.sendText('What is on for tomorrow?'))

    // On screen immediately, before anything has connected.
    expect(lines()).toEqual(['you: What is on for tomorrow?'])
    expect(voice).toMatchObject({ status: 'connecting', channel: 'text' })
    expect(session()).toMatchObject({ signedUrl: 'wss://signed.example/1', textOnly: true })
    expect(sdk.sendUserMessage).not.toHaveBeenCalled()

    connect()

    expect(sdk.sendUserMessage).toHaveBeenCalledWith('What is on for tomorrow?')
    expect(voice).toMatchObject({ status: 'live', channel: 'text', mode: 'listening' })
  })

  it('queues messages typed while connecting and sends them in order', async () => {
    mountEngine()
    await press(() => voice.sendText('First'))
    await press(() => voice.sendText('Second'))
    expect(sdk.startSession).toHaveBeenCalledTimes(1)

    connect()
    expect(sdk.sendUserMessage.mock.calls).toEqual([['First'], ['Second']])
  })

  it('ends a typed conversation before starting a spoken one', async () => {
    mountEngine()
    await press(() => voice.sendText('Hello'))
    connect()
    const typed = session()
    sdk.endSession.mockClear()

    await press(() => voice.startVoice())

    expect(sdk.endSession).toHaveBeenCalled()
    expect(sdk.endSession.mock.invocationCallOrder[0]).toBeLessThan(
      sdk.startSession.mock.invocationCallOrder[1] ?? 0,
    )
    expect(session()).toMatchObject({ signedUrl: 'wss://signed.example/2', textOnly: false })
    expect(voice).toMatchObject({ status: 'connecting', channel: 'voice' })

    // The typed session's goodbye arrives late and changes nothing.
    act(() => typed.onDisconnect({ reason: 'user' }))
    expect(voice).toMatchObject({ status: 'connecting', channel: 'voice' })

    connect()
    expect(voice).toMatchObject({ status: 'live', channel: 'voice' })
  })

  it('hangs up on stop and keeps the transcript', async () => {
    mountEngine()
    await press(() => voice.startVoice())
    connect()
    act(() => session().onMessage({ role: 'agent', message: 'Good evening.' }))
    sdk.endSession.mockClear()

    await press(() => voice.stop())

    expect(sdk.endSession).toHaveBeenCalledTimes(1)
    expect(voice).toMatchObject({ status: 'idle', channel: null, error: null })
    expect(lines()).toEqual(['jarvis: Good evening.'])

    await press(() => voice.clear())
    expect(voice.transcript).toEqual([])
  })

  it('treats Jarvis hanging up as a normal end', async () => {
    mountEngine()
    await press(() => voice.startVoice())
    connect()

    act(() => {
      sdk.set({ conversation: null })
      session().onDisconnect({ reason: 'agent', context: { type: 'end_call' } })
    })

    expect(voice).toMatchObject({ status: 'idle', error: null })
  })

  it('says the connection dropped when it does, and tries the same kind of conversation again', async () => {
    mountEngine()
    await press(() => voice.sendText('Hello'))
    connect()

    act(() => {
      sdk.set({ conversation: null })
      session().onDisconnect({ reason: 'error', message: 'WebSocket closed: 1006', context: { type: 'close' } })
    })
    expect(voice).toMatchObject({ status: 'error', error: 'The connection to Jarvis dropped.' })

    await press(() => voice.retry())
    expect(voice).toMatchObject({ status: 'connecting', channel: 'text', error: null })
    expect(session()).toMatchObject({ signedUrl: 'wss://signed.example/2', textOnly: true })
  })

  it('keeps the conversation going through an error that does not end it', async () => {
    mountEngine()
    await press(() => voice.startVoice())
    connect()

    act(() => session().onError('Server error: tool failed', { errorType: 'mcp_tool_error' }))

    expect(voice).toMatchObject({ status: 'live', error: null })
    expect(sdk.endSession).toHaveBeenCalledTimes(1) // only the one that precedes every start
  })

  it('explains how to switch typed chat on when the agent refuses a text-only start', async () => {
    mountEngine()
    await press(() => voice.sendText('Hello'))

    const refusal = Object.assign(new Error('Policy violation'), {
      name: 'SessionConnectionError',
      closeCode: 1008,
      closeReason: 'Policy violation',
    })
    act(() => session().onError('Policy violation', refusal))

    expect(voice).toMatchObject({ status: 'error', error: VOICE_MESSAGE.textDisabled })
    expect(VOICE_MESSAGE.textDisabled).toBe(
      'Typed chat isn’t switched on for your ElevenLabs agent yet. Enable the text-only override in the agent’s Security settings.',
    )
    // The typed line is still on screen, and trying again sends it.
    expect(lines()).toEqual(['you: Hello'])
    await press(() => voice.retry())
    connect()
    expect(sdk.sendUserMessage).toHaveBeenCalledWith('Hello')
  })

  it('ends a typed conversation when the agent refuses the override after connecting', async () => {
    mountEngine()
    await press(() => voice.sendText('Hello'))
    connect()

    act(() => session().onError('Server error: override not allowed', { errorType: 'override_error' }))

    expect(voice).toMatchObject({ status: 'error', error: VOICE_MESSAGE.textDisabled })
  })

  it('gives up on a typed start that never connects', async () => {
    vi.useFakeTimers()
    mountEngine()
    await press(() => voice.sendText('Hello'))
    expect(voice.status).toBe('connecting')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TEXT_CONNECT_TIMEOUT_MS)
    })

    expect(voice).toMatchObject({ status: 'error', error: VOICE_MESSAGE.noAnswer })
  })

  it('mutes only in a spoken conversation', async () => {
    mountEngine()
    await press(() => voice.sendText('Hello'))
    connect()
    act(() => voice.setMuted(true))
    expect(sdk.setMuted).not.toHaveBeenCalled()
    expect(voice.muted).toBe(false)

    await press(() => voice.startVoice())
    connect()
    act(() => voice.setMuted(true))
    expect(sdk.setMuted).toHaveBeenCalledWith(true)

    act(() => sdk.set({ isMuted: true }))
    expect(voice.muted).toBe(true)
  })

  it('reports who is speaking and the louder of the two volumes', async () => {
    mountEngine()
    await press(() => voice.startVoice())
    connect()

    act(() => sdk.set({ mode: 'speaking' }))
    expect(voice.mode).toBe('speaking')

    sdk.volume = { input: 0.1, output: 0.35 }
    expect(voice.getVolume()).toBe(0.35)
    sdk.volume = { input: 0.4, output: 0.05 }
    expect(voice.getVolume()).toBe(0.4)
  })

  it('tells Jarvis the owner is typing, only while a conversation is live', async () => {
    mountEngine()
    act(() => voice.typing())
    expect(sdk.sendUserActivity).not.toHaveBeenCalled()

    await press(() => voice.startVoice())
    connect()
    act(() => voice.typing())
    expect(sdk.sendUserActivity).toHaveBeenCalledTimes(1)
  })

  it('withdraws its controller when it unmounts', () => {
    const { unmount, onController } = mountEngine()
    unmount()
    expect(onController).toHaveBeenLastCalledWith(null)
  })
})
