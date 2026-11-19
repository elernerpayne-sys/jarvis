import { cn } from '@/lib/cn'
import type { StatusMeta, Tone } from '@/lib/status'

const DOT: Record<Tone, string> = {
  amber: 'bg-amber',
  ok: 'bg-ok',
  bad: 'bg-bad',
  neutral: 'bg-smoke',
}

const WORD: Record<Tone, string> = {
  amber: 'text-amber',
  ok: 'text-ash',
  bad: 'text-bad',
  neutral: 'text-ash',
}

/** Just the dot, for the start of a list row. */
export function Dot({ tone, pulse, className }: { tone: Tone; pulse?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-2 shrink-0 rounded-full', DOT[tone], pulse && 'animate-pulse-dot', className)}
    />
  )
}

/**
 * A status as a dot and a word. Pass a `StatusMeta` from `@/lib/status`:
 * `<StatusDot {...TASK_STATUS[task.status]} />`.
 */
export function StatusDot({ label, tone, pulse, className }: StatusMeta & { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 whitespace-nowrap text-sm', WORD[tone], className)}>
      <Dot tone={tone} pulse={pulse} />
      {label}
    </span>
  )
}
