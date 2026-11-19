/**
 * The demo stand-in for Jarvis's voice: no SDK, no network, never an error.
 *
 * A spoken conversation opens with a short briefing built from the sample
 * data, alternating between "speaking" (a line appears and a speech-like
 * level moves the ring) and "listening" pauses. Typed questions get canned
 * answers from the same data. It is a plain object, not a hook, so the whole
 * script can be driven by timers in a test.
 */
import { appendLine } from '@/features/voice/transcript'
import type { TranscriptLine, VoiceChannel, VoiceSnapshot } from '@/features/voice/types'
import { idleLevel, speechDuration, speechLevel } from '@/features/voice/demo/levels'
import type { MicMeter } from '@/features/voice/demo/micMeter'
import {
  DEMO_INTRO,
  answerQuestion,
  briefingTurns,
  loadAnswerData,
  loadBriefingData,
} from '@/features/voice/demo/script'
import type { DemoDataSource } from '@/features/voice/demo/script'

export const DEMO_TIMING = {
  /** "Connecting…" before a spoken conversation goes live. */
  voiceConnectMs: 700,
  /** The same for a typed one. */
  textConnectMs: 350,
  /** Jarvis listens this long between the turns of its briefing. */
  pauseMs: 2_600,
  /** The beat before Jarvis answers a typed question. */
  thinkMs: 650,
} as const

export interface DemoEngineOptions {
  /** Where the briefing and the answers get their numbers: the service layer. */
  source: DemoDataSource
  /** Opens a meter on the real microphone. Defaults to having none. */
  openMic?: () => Promise<MicMeter | null>
  now?: () => number
}

export interface DemoEngine {
  getState(): VoiceSnapshot
  subscribe(listener: () => void): () => void
  startVoice(): void
  stop(): void
  sendText(text: string): void
  setMuted(muted: boolean): void
  clear(): void
  getVolume(): number
}

const IDLE: VoiceSnapshot = {
  status: 'idle',
  mode: 'listening',
  channel: null,
  transcript: [],
  error: null,
  muted: false,
}

export function createDemoEngine({
  source,
  openMic = async () => null,
  now = Date.now,
}: DemoEngineOptions): DemoEngine {
  let state = IDLE
  const listeners = new Set<() => void>()
  const timers = new Set<ReturnType<typeof setTimeout>>()

  // Async work (the microphone prompt, a data read) checks these to find out
  // whether the conversation, or the thing Jarvis was saying, has moved on.
  let conversationId = 0
  let scriptId = 0

  let mic: MicMeter | null = null
  let lineCount = 0
  let modeSince = 0
  /** Typed questions not answered yet, oldest first. */
  let questions: string[] = []
  let answering = false

  function update(patch: Partial<VoiceSnapshot>) {
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
  }

  function after(ms: number, run: () => void) {
    const timer = setTimeout(() => {
      timers.delete(timer)
      run()
    }, ms)
    timers.add(timer)
  }

  function withLine(role: TranscriptLine['role'], text: string): TranscriptLine[] {
    lineCount += 1
    return appendLine(state.transcript, { id: `demo-${lineCount}`, role, text, at: now() })
  }

  function listen() {
    modeSince = now()
    update({ mode: 'listening' })
  }

  /**
   * Jarvis says one line. Spoken, it holds the floor for as long as the line
   * takes to say; typed, it simply appears. `also` rides along in the same
   * update, so the screen never shows a state in between.
   */
  function say(text: string, then?: () => void, also?: Partial<VoiceSnapshot>) {
    if (state.channel !== 'voice') {
      update({ ...also, transcript: withLine('jarvis', text) })
      then?.()
      return
    }
    modeSince = now()
    update({ ...also, transcript: withLine('jarvis', text), mode: 'speaking' })
    after(speechDuration(text), () => {
      listen()
      then?.()
    })
  }

  function sayInTurn(turns: string[]) {
    const [next, ...rest] = turns
    if (next === undefined) return
    after(DEMO_TIMING.pauseMs, () => say(next, () => sayInTurn(rest)))
  }

  /** Goes live already speaking: the intro first, then the day's numbers. */
  function openWithBriefing() {
    const script = scriptId
    const data = loadBriefingData(source)
    const thenTheNumbers = () => {
      void data.then((loaded) => {
        if (script === scriptId) sayInTurn(briefingTurns(loaded))
      })
    }
    say(DEMO_INTRO, thenTheNumbers, { status: 'live' })
  }

  function answerNext() {
    const question = questions.shift()
    if (question === undefined) {
      answering = false
      return
    }
    answering = true
    const script = scriptId
    const data = loadAnswerData(source)
    after(DEMO_TIMING.thinkMs, () => {
      void data.then((loaded) => {
        if (script === scriptId) say(answerQuestion(question, loaded), answerNext)
      })
    })
  }

  /** Drops whatever Jarvis was in the middle of saying. */
  function abandonScript() {
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
    scriptId += 1
  }

  function endConversation() {
    abandonScript()
    conversationId += 1
    questions = []
    answering = false
    mic?.stop()
    mic = null
  }

  async function followMicrophone() {
    const conversation = conversationId
    const meter = await openMic().catch(() => null)
    if (!meter) return
    // The conversation ended while the browser was still asking.
    if (conversation !== conversationId) meter.stop()
    else mic = meter
  }

  function open(channel: VoiceChannel) {
    // A question typed just before this conversation is answered in it.
    const carried = questions
    endConversation()
    questions = carried

    update({ status: 'connecting', channel, mode: 'listening', error: null, muted: false })
    if (channel === 'voice') void followMicrophone()

    after(channel === 'voice' ? DEMO_TIMING.voiceConnectMs : DEMO_TIMING.textConnectMs, () => {
      if (channel === 'voice' && questions.length === 0) {
        openWithBriefing()
        return
      }
      modeSince = now()
      update({ status: 'live' })
      answerNext()
    })
  }

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    startVoice() {
      if (state.channel === 'voice') return
      open('voice')
    },

    stop() {
      endConversation()
      if (state.status !== 'idle') {
        update({ status: 'idle', channel: null, mode: 'listening', muted: false })
      }
    },

    sendText(raw) {
      const text = raw.trim()
      if (!text) return
      questions.push(text)
      update({ transcript: withLine('you', text) })

      if (state.status === 'connecting') return
      if (state.status !== 'live') {
        open('text')
        return
      }
      if (answering) return
      // Typing over the briefing cuts it short, like interrupting a person.
      abandonScript()
      if (state.mode === 'speaking') listen()
      answerNext()
    },

    setMuted(muted) {
      if (state.status === 'live' && state.channel === 'voice' && state.muted !== muted) {
        update({ muted })
      }
    },

    clear() {
      if (state.transcript.length > 0) update({ transcript: [] })
    },

    getVolume() {
      if (state.status !== 'live' || state.channel !== 'voice') return 0
      const elapsed = now() - modeSince
      if (state.mode === 'speaking') return speechLevel(elapsed)
      if (state.muted) return 0
      return mic ? mic.level() : idleLevel(elapsed)
    },
  }
}
