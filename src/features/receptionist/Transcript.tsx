import { cn } from '@/lib/cn'
import { formatTimecode } from '@/lib/format'
import type { TranscriptTurn } from '@/lib/types'
import { Skeleton } from '@/components/ui/States'

// A narrow column for the timecode, the words beside it.
const TURN = 'grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-3'

/**
 * A call, turn by turn. Jarvis's lines are set in the voice typeface; the
 * caller's are plain and quieter, so the two read apart at a glance.
 */
export function Transcript({ turns }: { turns: readonly TranscriptTurn[] }) {
  return (
    <ol className="space-y-5">
      {turns.map((turn, index) => {
        const fromJarvis = turn.role === 'agent'
        return (
          <li key={`${index}-${turn.t}`} className={TURN}>
            <span className="pt-1.5 text-xs text-smoke tabular-nums">{formatTimecode(turn.t)}</span>
            <p className={cn(fromJarvis ? 'font-voice text-lg text-bone' : 'text-base text-ash')}>
              <span className="sr-only">{fromJarvis ? 'Jarvis: ' : 'Caller: '}</span>
              {turn.text}
            </p>
          </li>
        )
      })}
    </ol>
  )
}

const SKELETON_WIDTHS = ['w-11/12', 'w-3/5', 'w-4/5', 'w-2/5']

/** Stands in for the transcript while the full call loads. */
export function TranscriptSkeleton({ label = 'Loading transcript' }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-5">
      {SKELETON_WIDTHS.map((width) => (
        <div key={width} className={TURN}>
          <Skeleton className="mt-1.5 h-3 w-8" />
          <Skeleton className={cn('h-5', width)} />
        </div>
      ))}
    </div>
  )
}
