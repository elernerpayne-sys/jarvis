import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FakeSpeechRecognition } from '@/features/code/fakeSpeechRecognition'
import { useDictation } from '@/features/code/useDictation'

function renderDictation() {
  const onPhrase = vi.fn<(phrase: string) => void>()
  const view = renderHook(() => useDictation(onPhrase))
  return { ...view, onPhrase }
}

/** Starts dictating and hands back the recognizer the hook created. */
function startDictating(view: ReturnType<typeof renderDictation>) {
  act(() => view.result.current.start())
  return FakeSpeechRecognition.current
}

describe('useDictation', () => {
  beforeEach(() => {
    FakeSpeechRecognition.reset()
    vi.stubGlobal('SpeechRecognition', FakeSpeechRecognition)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('says so when the browser cannot dictate', () => {
    vi.unstubAllGlobals()
    const view = renderDictation()

    expect(view.result.current.supported).toBe(false)
    act(() => view.result.current.start())
    expect(view.result.current.listening).toBe(false)
    expect(FakeSpeechRecognition.instances).toHaveLength(0)
  })

  it('uses the prefixed recognizer where that is all there is', () => {
    vi.unstubAllGlobals()
    vi.stubGlobal('webkitSpeechRecognition', FakeSpeechRecognition)
    const view = renderDictation()

    expect(view.result.current.supported).toBe(true)
    startDictating(view)
    expect(view.result.current.listening).toBe(true)
  })

  it('starts listening continuously, with interim words, in the browser language', () => {
    const view = renderDictation()
    expect(view.result.current.supported).toBe(true)
    expect(view.result.current.listening).toBe(false)

    const recognizer = startDictating(view)

    expect(recognizer.started).toBe(true)
    expect(recognizer.continuous).toBe(true)
    expect(recognizer.interimResults).toBe(true)
    expect(recognizer.lang).toBe(navigator.language)
    expect(view.result.current.listening).toBe(true)
  })

  it('does not open a second session while one is running', () => {
    const view = renderDictation()
    startDictating(view)
    act(() => view.result.current.start())

    expect(FakeSpeechRecognition.instances).toHaveLength(1)
  })

  it('shows words as they are heard and hands over each finished phrase', () => {
    const view = renderDictation()
    const recognizer = startDictating(view)

    act(() => recognizer.hear([{ text: 'fix the' }]))
    expect(view.result.current.interim).toBe('fix the')
    expect(view.onPhrase).not.toHaveBeenCalled()

    act(() => recognizer.hear([{ text: 'fix the booking bug' }]))
    expect(view.result.current.interim).toBe('fix the booking bug')

    act(() => recognizer.hear([{ text: ' Fix the booking bug. ', final: true }]))
    expect(view.onPhrase).toHaveBeenCalledExactlyOnceWith('Fix the booking bug.')
    expect(view.result.current.interim).toBe('')
  })

  it('does not hand over a finished phrase twice when the next one starts', () => {
    const view = renderDictation()
    const recognizer = startDictating(view)

    act(() => recognizer.hear([{ text: 'Fix the booking bug.', final: true }]))
    // The browser keeps earlier results in the list and points past them.
    act(() => recognizer.hear([{ text: 'Fix the booking bug.', final: true }, { text: ' then add' }], 1))
    expect(view.result.current.interim).toBe('then add')

    act(() =>
      recognizer.hear([{ text: 'Fix the booking bug.', final: true }, { text: ' Then add a test.', final: true }], 1),
    )
    expect(view.onPhrase.mock.calls).toEqual([['Fix the booking bug.'], ['Then add a test.']])
  })

  it('stops when asked and keeps the words that were still on screen', () => {
    const view = renderDictation()
    const recognizer = startDictating(view)
    act(() => recognizer.hear([{ text: 'open a pull request' }]))

    act(() => view.result.current.stop())

    expect(recognizer.stopped).toBe(true)
    expect(view.result.current.listening).toBe(false)
    expect(view.result.current.interim).toBe('')
    expect(view.onPhrase).toHaveBeenCalledExactlyOnceWith('open a pull request')
  })

  it('goes back to idle when the browser ends the session by itself', () => {
    const view = renderDictation()
    const recognizer = startDictating(view)

    act(() => recognizer.end())

    expect(view.result.current.listening).toBe(false)
    expect(view.onPhrase).not.toHaveBeenCalled()
  })

  it('drops the phrase in progress when cancelled', () => {
    const view = renderDictation()
    const recognizer = startDictating(view)
    act(() => recognizer.hear([{ text: 'never mind' }]))

    act(() => view.result.current.cancel())

    expect(recognizer.aborted).toBe(true)
    expect(view.result.current.listening).toBe(false)
    expect(view.result.current.interim).toBe('')
    expect(view.result.current.error).toBeNull()
    expect(view.onPhrase).not.toHaveBeenCalled()
  })

  it.each(['not-allowed', 'service-not-allowed'])('explains a blocked microphone (%s)', (code) => {
    const view = renderDictation()
    const recognizer = startDictating(view)

    act(() => {
      recognizer.fail(code)
      recognizer.end()
    })

    expect(view.result.current.error).toBe(
      'Microphone access was blocked. Allow it in your browser settings, or type instead.',
    )
    expect(view.result.current.listening).toBe(false)
  })

  it('asks to try again when nothing was heard, and clears that on the next try', () => {
    const view = renderDictation()
    const recognizer = startDictating(view)

    act(() => {
      recognizer.fail('no-speech')
      recognizer.end()
    })
    expect(view.result.current.error).toBe('Didn’t catch that. Try again.')

    startDictating(view)
    expect(view.result.current.error).toBeNull()
    expect(view.result.current.listening).toBe(true)
  })

  it('reports a problem when the browser refuses to start', () => {
    const view = renderDictation()
    vi.spyOn(FakeSpeechRecognition.prototype, 'start').mockImplementation(() => {
      throw new Error('InvalidStateError')
    })

    act(() => view.result.current.start())

    expect(view.result.current.listening).toBe(false)
    expect(view.result.current.error).toBe('Dictation stopped working. Try again, or type instead.')
  })

  it('lets go of the microphone when the screen goes away', () => {
    const view = renderDictation()
    const recognizer = startDictating(view)

    view.unmount()

    expect(recognizer.aborted).toBe(true)
    expect(view.onPhrase).not.toHaveBeenCalled()
  })

  it('treats zero-confidence "final" results on Android as still in progress', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 Chrome/142.0 Mobile Safari/537.36',
    )
    const view = renderDictation()
    const recognizer = startDictating(view)

    act(() => recognizer.hear([{ text: 'fix', final: true, confidence: 0 }]))
    act(() => recognizer.hear([{ text: 'fix the bug', final: true, confidence: 0 }]))
    expect(view.onPhrase).not.toHaveBeenCalled()
    expect(view.result.current.interim).toBe('fix the bug')

    act(() => recognizer.hear([{ text: 'fix the bug', final: true, confidence: 0.92 }]))
    expect(view.onPhrase).toHaveBeenCalledExactlyOnceWith('fix the bug')
    expect(view.result.current.interim).toBe('')
  })
})
