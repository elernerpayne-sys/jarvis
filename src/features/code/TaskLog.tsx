import { useLayoutEffect, useRef } from 'react'

import { cn } from '@/lib/cn'
import { formatTime } from '@/lib/format'
import type { TaskEvent, TaskEventKind } from '@/lib/types'
import { Dot } from '@/components/ui/StatusDot'

/** How close to the end still counts as "at the bottom", in pixels. */
const PIN_SLACK = 24

/**
 * Keeps a scrolling box on its newest line, but only while the reader is
 * already there. Scroll up to read something and it stays put.
 * `content` is anything that changes when a line is added.
 */
function usePinnedToBottom(content: unknown) {
  const ref = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  function onScroll() {
    const box = ref.current
    if (!box) return
    pinned.current = box.scrollHeight - box.scrollTop - box.clientHeight <= PIN_SLACK
  }

  useLayoutEffect(() => {
    const box = ref.current
    if (box && pinned.current) box.scrollTop = box.scrollHeight
  }, [content])

  return { ref, onScroll }
}

const LINE_STYLE: Record<TaskEventKind, string> = {
  status: 'font-medium text-bone',
  log: 'text-ash',
  command: 'font-mono text-bone',
  error: 'text-bad',
}

/** A fixed column, so every message starts at the same edge. */
const TIME_COLUMN = 'w-16 shrink-0'

/** A task's progress log, oldest line first, like a terminal. */
export function TaskLog({ events, working }: { events: TaskEvent[]; working: boolean }) {
  const { ref, onScroll } = usePinnedToBottom(`${events.length}:${working}`)

  return (
    <div
      ref={ref}
      onScroll={onScroll}
      role="log"
      aria-live="polite"
      aria-label="Progress log"
      // Focusable so the log can be scrolled from the keyboard.
      tabIndex={0}
      className="max-h-[min(28rem,60dvh)] overflow-y-auto rounded-2xl border border-line bg-raised py-3"
    >
      <ol>
        {events.map((event) => (
          <li key={event.id} className="flex items-baseline gap-3 px-4 py-1.5">
            <time dateTime={event.created_at} className={cn(TIME_COLUMN, 'text-xs text-smoke tabular-nums')}>
              {formatTime(event.created_at)}
            </time>
            <p className={cn('min-w-0 flex-1 whitespace-pre-wrap text-sm wrap-anywhere', LINE_STYLE[event.kind])}>
              {event.kind === 'error' ? <span className="sr-only">Error: </span> : null}
              {event.message}
            </p>
          </li>
        ))}
      </ol>
      {working ? (
        <p className="flex items-center gap-3 px-4 py-1.5 text-sm text-ash">
          <span className={cn(TIME_COLUMN, 'flex')}>
            <Dot tone="amber" pulse />
          </span>
          Jarvis is working…
        </p>
      ) : null}
    </div>
  )
}
