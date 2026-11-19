import { useCallback, useEffect, useRef, useState } from 'react'

/*
 * The slice of the Web Speech API this hook uses. TypeScript's DOM library
 * has no `SpeechRecognition` class, and Safari only has the prefixed one, so
 * the shape is spelled out here.
 */
interface RecognitionAlternative {
  readonly transcript: string
  readonly confidence: number
}

interface RecognitionResult {
  readonly isFinal: boolean
  readonly [index: number]: RecognitionAlternative
}

interface RecognitionResultEvent {
  /** The lowest index in `results` that changed. */
  readonly resultIndex: number
  readonly results: ArrayLike<RecognitionResult>
}

interface RecognitionErrorEvent {
  readonly error: string
}

export interface SpeechRecognizer {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: RecognitionResultEvent) => void) | null
  onerror: ((event: RecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  start(): void
  /** Stops listening; words already heard are still delivered. */
  stop(): void
  /** Stops listening and drops whatever was in progress. */
  abort(): void
}

export type SpeechRecognizerConstructor = new () => SpeechRecognizer

type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognizerConstructor
  webkitSpeechRecognition?: SpeechRecognizerConstructor
}

function findRecognizer(): SpeechRecognizerConstructor | null {
  if (typeof window === 'undefined') return null
  const scope: SpeechWindow = window
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null
}

/** What to tell the owner for each failure, or null when there is nothing to say. */
function messageFor(code: string): string | null {
  switch (code) {
    case 'aborted':
      // We stopped it ourselves, or the browser gave the microphone away.
      return null
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access was blocked. Allow it in your browser settings, or type instead.'
    case 'no-speech':
      return 'Didn’t catch that. Try again.'
    case 'audio-capture':
      return 'No microphone was found. Connect one, or type instead.'
    case 'network':
      return 'Dictation needs a connection. Check yours, or type instead.'
    default:
      return 'Dictation stopped working. Try again, or type instead.'
  }
}

/**
 * Chrome on Android flags every partial result as final and gives the partial
 * ones a confidence of 0. Unless those are treated as still in progress, each
 * phrase is written out several times over.
 */
function isSettled(result: RecognitionResult, android: boolean): boolean {
  if (!result.isFinal) return false
  return !android || (result[0]?.confidence ?? 0) > 0
}

export interface Dictation {
  /** False where the browser has no speech recognition (Firefox, some Safari). */
  supported: boolean
  listening: boolean
  /** Words heard in the phrase still being spoken. They can still change. */
  interim: string
  /** A sentence for the owner when dictation fails, otherwise null. */
  error: string | null
  start: () => void
  /** Finish up: the phrase in progress is still delivered. */
  stop: () => void
  /** Stop at once and drop the phrase in progress. */
  cancel: () => void
}

/**
 * Speech to text through the browser. `onPhrase` is called with each finished
 * phrase, trimmed, ready to be added to the text; `interim` holds the words of
 * the phrase still being spoken so they can be shown live.
 */
export function useDictation(onPhrase: (phrase: string) => void): Dictation {
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState<string | null>(null)

  // The session in progress. Events from any earlier session are ignored.
  const session = useRef<SpeechRecognizer | null>(null)
  // Mirrors `interim` for the handlers, which outlive the render they came from.
  const heard = useRef('')
  const deliver = useRef(onPhrase)
  useEffect(() => {
    deliver.current = onPhrase
  })

  const start = useCallback(() => {
    const Recognizer = findRecognizer()
    if (!Recognizer || session.current) return

    const recognizer = new Recognizer()
    recognizer.continuous = true
    recognizer.interimResults = true
    recognizer.lang = navigator.language
    const android = /android/i.test(navigator.userAgent)

    const showInterim = (words: string) => {
      heard.current = words
      setInterim(words)
    }

    recognizer.onresult = (event) => {
      if (session.current !== recognizer) return
      let inProgress = ''
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        const transcript = result[0]?.transcript ?? ''
        if (isSettled(result, android)) {
          const phrase = transcript.trim()
          if (phrase) deliver.current(phrase)
        } else {
          inProgress += transcript
        }
      }
      showInterim(inProgress.trim())
    }

    recognizer.onerror = (event) => {
      if (session.current !== recognizer) return
      const message = messageFor(event.error)
      if (message) setError(message)
    }

    recognizer.onend = () => {
      if (session.current !== recognizer) return
      session.current = null
      // A session can end before its last words settle. They were on screen,
      // so they stay.
      if (heard.current) deliver.current(heard.current)
      showInterim('')
      setListening(false)
    }

    session.current = recognizer
    setError(null)
    try {
      recognizer.start()
      setListening(true)
    } catch {
      session.current = null
      setError(messageFor('start-failed'))
    }
  }, [])

  const stop = useCallback(() => {
    session.current?.stop()
  }, [])

  const cancel = useCallback(() => {
    const recognizer = session.current
    if (!recognizer) return
    // Let go of the session first, so nothing it still sends is used.
    session.current = null
    heard.current = ''
    recognizer.abort()
    setInterim('')
    setListening(false)
  }, [])

  // Never leave the microphone open behind a screen that is gone.
  useEffect(
    () => () => {
      const recognizer = session.current
      session.current = null
      recognizer?.abort()
    },
    [],
  )

  return { supported: findRecognizer() !== null, listening, interim, error, start, stop, cancel }
}
