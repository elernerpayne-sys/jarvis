/**
 * Test double for the browser's speech recognition. Tests install it with
 * `vi.stubGlobal('SpeechRecognition', FakeSpeechRecognition)` and then play
 * the browser's part with `hear`, `fail` and `end`.
 */
import type { SpeechRecognizer } from '@/features/code/useDictation'

interface HeardResult {
  text: string
  final?: boolean
  /** Defaults to 0.9 for final results and 0 for ones still in progress. */
  confidence?: number
}

export class FakeSpeechRecognition implements SpeechRecognizer {
  /** Every recognizer created since the last `reset()`, oldest first. */
  static instances: FakeSpeechRecognition[] = []

  static reset(): void {
    FakeSpeechRecognition.instances = []
  }

  /** The recognizer the code under test created most recently. */
  static get current(): FakeSpeechRecognition {
    const latest = FakeSpeechRecognition.instances.at(-1)
    if (!latest) throw new Error('No speech recognition has been started.')
    return latest
  }

  continuous = false
  interimResults = false
  lang = ''
  onresult: SpeechRecognizer['onresult'] = null
  onerror: SpeechRecognizer['onerror'] = null
  onend: SpeechRecognizer['onend'] = null

  started = false
  stopped = false
  aborted = false

  constructor() {
    FakeSpeechRecognition.instances.push(this)
  }

  start(): void {
    this.started = true
  }

  /** Like the browser: a stopped session winds down, then says it ended. */
  stop(): void {
    this.stopped = true
    this.end()
  }

  /** Like the browser: an aborted session reports "aborted", then ends. */
  abort(): void {
    this.aborted = true
    this.fail('aborted')
    this.end()
  }

  /**
   * The browser reporting what it has heard so far in this session.
   * `resultIndex` is the first entry that changed since the last report.
   */
  hear(results: HeardResult[], resultIndex = 0): void {
    this.onresult?.({
      resultIndex,
      results: results.map(({ text, final = false, confidence }) => ({
        isFinal: final,
        0: { transcript: text, confidence: confidence ?? (final ? 0.9 : 0) },
      })),
    })
  }

  fail(error: string): void {
    this.onerror?.({ error })
  }

  end(): void {
    this.started = false
    this.onend?.()
  }
}
