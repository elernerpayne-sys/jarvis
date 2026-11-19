import { useLayoutEffect, useRef } from 'react'
import type { UIEvent } from 'react'

import { cn } from '@/lib/cn'
import type { TranscriptLine } from '@/features/voice/types'

/** Within this many pixels of the end still counts as "at the newest line". */
const PINNED_SLACK_PX = 48

/**
 * The conversation so far, newest at the bottom. Jarvis's lines are set in
 * the serif; the owner's own words stay in the sans, to the right.
 *
 * The region scrolls on its own and stays on the newest line, unless the
 * owner has scrolled up to read something earlier.
 */
export function Transcript({
  lines,
  thinking,
  className,
}: {
  lines: TranscriptLine[]
  /** Jarvis owes an answer: show a quiet "…" under the last line. */
  thinking: boolean
  className?: string
}) {
  const region = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  useLayoutEffect(() => {
    const element = region.current
    if (element && pinned.current) element.scrollTop = element.scrollHeight
  }, [lines, thinking])

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    const element = event.currentTarget
    const fromEnd = element.scrollHeight - element.scrollTop - element.clientHeight
    pinned.current = fromEnd <= PINNED_SLACK_PX
  }

  return (
    <div
      ref={region}
      role="log"
      aria-live="polite"
      aria-label="Conversation with Jarvis"
      // Focusable so the region can be scrolled from the keyboard.
      tabIndex={0}
      onScroll={handleScroll}
      className={cn(
        'max-h-[40vh] overflow-y-auto overscroll-contain rounded-xl text-left lg:max-h-[30vh]',
        className,
      )}
    >
      <ol className="space-y-4">
        {lines.map((line) =>
          line.role === 'jarvis' ? (
            <li key={line.id} className="mr-6 font-voice text-lg text-bone">
              <span className="sr-only">Jarvis: </span>
              {line.text}
            </li>
          ) : (
            <li key={line.id} className="ml-10 text-right text-base text-ash">
              <span className="sr-only">You: </span>
              {line.text}
            </li>
          ),
        )}
      </ol>
      {thinking ? (
        // Decoration only: a screen reader hears Jarvis's answer when it lands.
        <p aria-hidden className="mt-4 font-voice text-lg leading-6 text-smoke">
          …
        </p>
      ) : null}
    </div>
  )
}
