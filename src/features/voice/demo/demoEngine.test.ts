import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEMO_TIMING, createDemoEngine } from '@/features/voice/demo/demoEngine'
import { speechDuration } from '@/features/voice/demo/levels'
import { DATA_UNAVAILABLE, DEMO_INTRO } from '@/features/voice/demo/script'
import { sampleSource } from '@/features/voice/testing'

/** Long enough for any one line to be spoken. */
const ONE_LINE_MS = 12_000

function jarvisLines(engine: ReturnType<typeof createDemoEngine>): string[] {
  return engine
    .getState()
    .transcript.filter((line) => line.role === 'jarvis')
    .map((line) => line.text)
}

function lastLine(engine: ReturnType<typeof createDemoEngine>): string | undefined {
  return engine.getState().transcript.at(-1)?.text
}

describe('demo engine', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('connects, then opens by saying it is running on sample data', async () => {
    const engine = createDemoEngine({ source: sampleSource() })

    engine.startVoice()
    expect(engine.getState()).toMatchObject({ status: 'connecting', channel: 'voice', transcript: [] })

    await vi.advanceTimersByTimeAsync(DEMO_TIMING.voiceConnectMs)
    expect(engine.getState()).toMatchObject({ status: 'live', channel: 'voice', mode: 'speaking' })
    expect(jarvisLines(engine)).toEqual([DEMO_INTRO])
    expect(DEMO_INTRO).toContain('sample data')
  })

  it('briefs the owner from the service data, taking turns to speak and listen', async () => {
    const source = sampleSource()
    const engine = createDemoEngine({ source })
    const modes: string[] = []
    engine.subscribe(() => {
      const { status, mode } = engine.getState()
      if (status === 'live' && modes.at(-1) !== mode) modes.push(mode)
    })

    engine.startVoice()
    await vi.advanceTimersByTimeAsync(DEMO_TIMING.voiceConnectMs)

    // The intro takes as long as it would take to say.
    await vi.advanceTimersByTimeAsync(speechDuration(DEMO_INTRO) - 1)
    expect(engine.getState().mode).toBe('speaking')
    await vi.advanceTimersByTimeAsync(1)
    expect(engine.getState().mode).toBe('listening')

    // A pause, then the next turn.
    await vi.advanceTimersByTimeAsync(DEMO_TIMING.pauseMs)
    expect(engine.getState().mode).toBe('speaking')
    expect(lastLine(engine)).toContain('14 calls')

    await vi.advanceTimersByTimeAsync(3 * (ONE_LINE_MS + DEMO_TIMING.pauseMs))

    const [, calls, approvals, coding, ...more] = jarvisLines(engine)
    expect(calls).toContain('booked 9 appointments')
    expect(calls).toContain('2 calls were missed')
    expect(approvals).toContain('Push the booking fix and open a pull request?')
    expect(coding).toContain('Fix the double-booking bug')
    expect(more).toEqual([])

    expect(source.listApprovals).toHaveBeenCalledWith({ status: 'pending' })
    expect(modes).toEqual([
      'speaking', 'listening', 'speaking', 'listening', 'speaking', 'listening', 'speaking', 'listening',
    ])
    expect(engine.getState()).toMatchObject({ status: 'live', mode: 'listening', error: null })
  })

  it('says it cannot reach the data instead of failing', async () => {
    const source = sampleSource()
    source.listTasks.mockRejectedValue(new Error('Sample data is unavailable.'))
    const engine = createDemoEngine({ source })

    engine.startVoice()
    await vi.advanceTimersByTimeAsync(60_000)

    expect(jarvisLines(engine)).toEqual([DEMO_INTRO, DATA_UNAVAILABLE])
    expect(engine.getState()).toMatchObject({ status: 'live', mode: 'listening', error: null })
  })

  it('moves the ring like speech while speaking and follows the microphone while listening', async () => {
    const meter = { level: vi.fn(() => 0.42), stop: vi.fn() }
    const engine = createDemoEngine({ source: sampleSource(), openMic: async () => meter })

    expect(engine.getVolume()).toBe(0)
    engine.startVoice()
    await vi.advanceTimersByTimeAsync(DEMO_TIMING.voiceConnectMs)

    const spoken = new Set<number>()
    for (let step = 0; step < 20; step += 1) {
      await vi.advanceTimersByTimeAsync(50)
      spoken.add(engine.getVolume())
    }
    expect(spoken.size).toBeGreaterThan(10)
    expect(Math.max(...spoken)).toBeLessThanOrEqual(1)
    expect(Math.min(...spoken)).toBeGreaterThanOrEqual(0)
    expect(meter.level).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(speechDuration(DEMO_INTRO))
    expect(engine.getState().mode).toBe('listening')
    expect(engine.getVolume()).toBe(0.42)

    engine.setMuted(true)
    expect(engine.getState().muted).toBe(true)
    expect(engine.getVolume()).toBe(0)
  })

  it('carries on with a soft idle level when the microphone is refused', async () => {
    const engine = createDemoEngine({
      source: sampleSource(),
      openMic: () => Promise.reject(new DOMException('Denied', 'NotAllowedError')),
    })

    engine.startVoice()
    await vi.advanceTimersByTimeAsync(DEMO_TIMING.voiceConnectMs + speechDuration(DEMO_INTRO))

    expect(engine.getState()).toMatchObject({ status: 'live', mode: 'listening', error: null })
    expect(engine.getVolume()).toBeGreaterThan(0)
    expect(engine.getVolume()).toBeLessThan(0.1)
  })

  it('stops everything: no more lines, no timers left, microphone released', async () => {
    const meter = { level: () => 0.2, stop: vi.fn() }
    const engine = createDemoEngine({ source: sampleSource(), openMic: async () => meter })

    engine.startVoice()
    await vi.advanceTimersByTimeAsync(DEMO_TIMING.voiceConnectMs + 500)
    engine.stop()

    expect(engine.getState()).toMatchObject({ status: 'idle', channel: null, mode: 'listening' })
    expect(meter.stop).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)

    await vi.advanceTimersByTimeAsync(60_000)
    // What was said stays on screen; nothing is added.
    expect(jarvisLines(engine)).toEqual([DEMO_INTRO])
    expect(engine.getVolume()).toBe(0)
  })

  it('lets go of a microphone that was granted after the conversation ended', async () => {
    const meter = { level: () => 0.2, stop: vi.fn() }
    let grant: (value: typeof meter) => void = () => {}
    const engine = createDemoEngine({
      source: sampleSource(),
      openMic: () => new Promise((resolve) => (grant = resolve)),
    })

    engine.startVoice()
    engine.stop()
    grant(meter)
    await vi.advanceTimersByTimeAsync(0)

    expect(meter.stop).toHaveBeenCalledTimes(1)
  })

  it('answers a typed question in a typed conversation, without the microphone', async () => {
    const openMic = vi.fn(async () => null)
    const engine = createDemoEngine({ source: sampleSource(), openMic })

    engine.sendText('  Any missed calls?  ')
    expect(engine.getState()).toMatchObject({ status: 'connecting', channel: 'text' })
    expect(lastLine(engine)).toBe('Any missed calls?')

    await vi.advanceTimersByTimeAsync(DEMO_TIMING.textConnectMs + DEMO_TIMING.thinkMs)

    expect(engine.getState()).toMatchObject({ status: 'live', channel: 'text', mode: 'listening' })
    expect(lastLine(engine)).toContain('2 calls were missed')
    expect(openMic).not.toHaveBeenCalled()
    // Typed conversations make no sound.
    expect(engine.getVolume()).toBe(0)
  })

  it.each([
    ['how many calls came in?', '14 calls'],
    ['bookings?', '9 appointments'],
    ['what is waiting for approval?', '2 things are waiting'],
    ['tasks', 'Fix the double-booking bug'],
    ['Fade Factory', 'Fade Factory has had 9 calls'],
    ['hello', 'This is the demo'],
    ['help', 'In the demo I can tell you about'],
    ['sing me a song', 'I can only answer from the sample data'],
  ])('answers "%s" by keyword', async (question, expected) => {
    const engine = createDemoEngine({ source: sampleSource() })
    engine.sendText(question)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(lastLine(engine)).toContain(expected)
  })

  it('answers every question in order when several are typed quickly', async () => {
    const engine = createDemoEngine({ source: sampleSource() })
    engine.sendText('calls')
    engine.sendText('tasks')
    await vi.advanceTimersByTimeAsync(5_000)

    expect(engine.getState().transcript.map((line) => line.role)).toEqual(['you', 'you', 'jarvis', 'jarvis'])
    const [first, second] = jarvisLines(engine)
    expect(first).toContain('14 calls')
    expect(second).toContain('Fix the double-booking bug')
  })

  it('lets a typed question cut the briefing short, and answers it aloud', async () => {
    const engine = createDemoEngine({ source: sampleSource() })
    engine.startVoice()
    await vi.advanceTimersByTimeAsync(DEMO_TIMING.voiceConnectMs + 1_000)
    expect(engine.getState().mode).toBe('speaking')

    engine.sendText('What needs my approval?')
    expect(engine.getState().mode).toBe('listening')

    await vi.advanceTimersByTimeAsync(DEMO_TIMING.thinkMs)
    expect(engine.getState()).toMatchObject({ channel: 'voice', mode: 'speaking' })
    expect(lastLine(engine)).toContain('Push the booking fix')

    // The rest of the briefing never arrives.
    await vi.advanceTimersByTimeAsync(60_000)
    expect(jarvisLines(engine)).toHaveLength(2)
    expect(engine.getState().mode).toBe('listening')
  })

  it('ends a typed conversation before starting a spoken one', async () => {
    const engine = createDemoEngine({ source: sampleSource() })
    engine.sendText('hello')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(engine.getState()).toMatchObject({ status: 'live', channel: 'text' })

    engine.startVoice()
    expect(engine.getState()).toMatchObject({ status: 'connecting', channel: 'voice' })
    await vi.advanceTimersByTimeAsync(DEMO_TIMING.voiceConnectMs)
    expect(engine.getState()).toMatchObject({ status: 'live', channel: 'voice', mode: 'speaking' })
  })

  it('mutes only in a spoken conversation, and clears the transcript on request', async () => {
    const engine = createDemoEngine({ source: sampleSource() })
    engine.sendText('hello')
    await vi.advanceTimersByTimeAsync(5_000)

    engine.setMuted(true)
    expect(engine.getState().muted).toBe(false)

    engine.stop()
    expect(engine.getState().transcript).toHaveLength(2)
    engine.clear()
    expect(engine.getState().transcript).toEqual([])
  })
})
