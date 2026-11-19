import { describe, expect, it } from 'vitest'

import {
  appendLine,
  correctJarvisLine,
  createEchoFilter,
  isAwaitingReply,
} from '@/features/voice/transcript'
import type { TranscriptLine } from '@/features/voice/types'

function line(id: string, role: TranscriptLine['role'], text: string): TranscriptLine {
  return { id, role, text, at: 0 }
}

describe('transcript', () => {
  it('adds lines at the end and drops the oldest once it gets very long', () => {
    let lines: TranscriptLine[] = []
    for (let index = 0; index < 205; index += 1) {
      lines = appendLine(lines, line(`l${index}`, 'jarvis', `Line ${index}`))
    }
    expect(lines).toHaveLength(200)
    expect(lines.at(0)?.text).toBe('Line 5')
    expect(lines.at(-1)?.text).toBe('Line 204')
  })

  it('replaces what Jarvis meant to say with what it actually said', () => {
    const lines = [
      line('a', 'jarvis', 'Good evening.'),
      line('b', 'you', 'What did I miss?'),
      line('c', 'jarvis', 'Two calls came in and one of them booked a fade for Friday.'),
    ]
    const corrected = correctJarvisLine(
      lines,
      'Two calls came in and one of them booked a fade for Friday.',
      'Two calls came in and',
    )
    expect(corrected.map((entry) => entry.text)).toEqual([
      'Good evening.',
      'What did I miss?',
      'Two calls came in and',
    ])
    expect(corrected[2]?.id).toBe('c')
  })

  it('corrects the newest Jarvis line when the original wording is not found', () => {
    const lines = [line('a', 'jarvis', 'First.'), line('b', 'jarvis', 'Second, at length.')]
    expect(correctJarvisLine(lines, 'something else', 'Second').at(-1)?.text).toBe('Second')
  })

  it('removes the line when Jarvis was cut off before saying anything', () => {
    const lines = [line('a', 'you', 'Stop.'), line('b', 'jarvis', 'Of course, I will')]
    expect(correctJarvisLine(lines, 'Of course, I will', '  ')).toEqual([lines[0]])
  })

  it('knows when Jarvis owes an answer', () => {
    expect(isAwaitingReply([])).toBe(false)
    expect(isAwaitingReply([line('a', 'you', 'Hello?')])).toBe(true)
    expect(isAwaitingReply([line('a', 'you', 'Hello?'), line('b', 'jarvis', 'Hello.')])).toBe(false)
  })
})

describe('echo filter', () => {
  it('recognises a typed message coming back once, whatever its case or spacing', () => {
    const echoes = createEchoFilter()
    echoes.remember('Any missed calls?')
    expect(echoes.isEcho('  any missed calls? ')).toBe(true)
    // The same words spoken afterwards are a new turn.
    expect(echoes.isEcho('Any missed calls?')).toBe(false)
  })

  it('forgets a typed message after a while', () => {
    let clock = 0
    const echoes = createEchoFilter(15_000, () => clock)
    echoes.remember('Hello')
    clock = 16_000
    expect(echoes.isEcho('Hello')).toBe(false)
  })
})
