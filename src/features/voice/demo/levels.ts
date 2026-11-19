/**
 * Made-up loudness for the demo, in the same range the real agent reports
 * (speech sits around 0.1 to 0.4), so the Talk ring moves the same way.
 */

const TAU = Math.PI * 2

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/** About 60ms a character: an unhurried speaking pace. */
const MS_PER_CHARACTER = 60
const SHORTEST_LINE_MS = 1_800
const LONGEST_LINE_MS = 11_000

/** How long Jarvis "speaks" a line for. */
export function speechDuration(text: string): number {
  return Math.min(LONGEST_LINE_MS, Math.max(SHORTEST_LINE_MS, text.length * MS_PER_CHARACTER))
}

/**
 * Loudness of a voice `elapsedMs` into a line: syllables at about four a
 * second, phrases that rise and fall, and a short breath now and then.
 */
export function speechLevel(elapsedMs: number): number {
  const t = elapsedMs / 1000
  const syllable = 0.5 + 0.5 * Math.sin(t * TAU * 4.1)
  const phrase = 0.65 + 0.35 * Math.sin(t * TAU * 0.45 + 1.2)
  const texture = 0.5 + 0.5 * Math.sin(t * TAU * 9.7 + 0.6)
  const breath = Math.sin(t * TAU * 0.3 + 2.1) > -0.9 ? 1 : 0.2
  return clamp01((0.06 + 0.26 * syllable ** 1.6 * phrase + 0.05 * texture) * breath)
}

/** A quiet room: a slow swell, used while listening without a microphone. */
export function idleLevel(elapsedMs: number): number {
  const t = elapsedMs / 1000
  return 0.05 + 0.03 * Math.sin(t * TAU * 0.22)
}
