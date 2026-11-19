import type { TranscriptLine } from '@/features/voice/types'

/** Enough for a long conversation without the page growing forever. */
const MAX_LINES = 200

export function appendLine(lines: TranscriptLine[], line: TranscriptLine): TranscriptLine[] {
  return [...lines, line].slice(-MAX_LINES)
}

/**
 * Jarvis was cut off: swap what it meant to say for what it actually said.
 * Falls back to its newest line when the original text is not found, and
 * drops the line when nothing was said at all.
 */
export function correctJarvisLine(
  lines: TranscriptLine[],
  original: string,
  corrected: string,
): TranscriptLine[] {
  const wanted = original.trim()
  let index = lines.findLastIndex((line) => line.role === 'jarvis' && line.text === wanted)
  if (index === -1) index = lines.findLastIndex((line) => line.role === 'jarvis')
  const current = lines[index]
  if (!current) return lines

  const text = corrected.trim()
  if (text === current.text) return lines
  const next = lines.slice()
  if (text) next[index] = { ...current, text }
  else next.splice(index, 1)
  return next
}

/** True while Jarvis owes an answer: you spoke or typed last. */
export function isAwaitingReply(lines: TranscriptLine[]): boolean {
  return lines.at(-1)?.role === 'you'
}

export interface EchoFilter {
  /** Call when a typed message is put on screen. */
  remember(text: string): void
  /** True (once) when the agent repeats a typed message back as a transcript. */
  isEcho(text: string): boolean
  reset(): void
}

/**
 * Typed messages are shown the moment they are sent. If the agent then
 * reports the same words as a user transcript, that copy is dropped.
 */
export function createEchoFilter(windowMs = 15_000, now: () => number = Date.now): EchoFilter {
  let recent: Array<{ text: string; at: number }> = []
  const key = (text: string) => text.trim().toLowerCase()

  return {
    remember(text) {
      recent.push({ text: key(text), at: now() })
    },
    isEcho(text) {
      const cutoff = now() - windowMs
      recent = recent.filter((entry) => entry.at >= cutoff)
      const index = recent.findIndex((entry) => entry.text === key(text))
      if (index === -1) return false
      recent.splice(index, 1)
      return true
    },
    reset() {
      recent = []
    },
  }
}
