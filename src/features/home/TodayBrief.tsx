import { Link } from 'react-router'

import { cn } from '@/lib/cn'
import { plural } from '@/lib/format'
import { routes } from '@/lib/links'
import type { Brief } from '@/lib/types'
import { useBrief } from '@/services/hooks'
import { Section } from '@/components/ui/Page'
import { QueryView, Skeleton } from '@/components/ui/States'

interface Figure {
  key: 'calls_answered' | 'bookings_made' | 'missed_calls' | 'tasks_finished'
  /** The short word under the number. */
  label: string
  /** The whole thing in words, for screen readers: "1 call missed". */
  spoken: (count: number) => string
  /** Where the number comes from. */
  to: string
  /** Anything above zero here is a problem and shows in red. */
  badWhenAboveZero?: boolean
}

const FIGURES: readonly Figure[] = [
  {
    key: 'calls_answered',
    label: 'Answered',
    spoken: (count) => `${plural(count, 'call')} answered`,
    to: routes.receptionist,
  },
  {
    key: 'bookings_made',
    label: 'Booked',
    spoken: (count) => `${plural(count, 'appointment')} booked`,
    to: routes.receptionist,
  },
  {
    key: 'missed_calls',
    label: 'Missed',
    spoken: (count) => `${plural(count, 'call')} missed`,
    to: routes.receptionist,
    badWhenAboveZero: true,
  },
  {
    key: 'tasks_finished',
    label: 'Tasks done',
    spoken: (count) => `${plural(count, 'task')} done`,
    to: routes.code,
  },
]

// One strip, four equal columns, hairlines between them. The first column
// has no left padding so its number lines up with the heading above.
const STRIP = 'grid grid-cols-4 divide-x divide-line border-y border-line'

function columnClass(index: number): string {
  return cn('flex flex-col gap-1 py-4', index > 0 && 'pl-2.5 sm:pl-4')
}

function BriefFigures({ brief }: { brief: Brief }) {
  return (
    <ul aria-label="Today" className={STRIP}>
      {FIGURES.map((figure, index) => {
        const count = brief[figure.key]
        const bad = figure.badWhenAboveZero === true && count > 0
        return (
          <li key={figure.key} className="min-w-0">
            <Link
              to={figure.to}
              aria-label={figure.spoken(count)}
              className={cn('group h-full rounded-lg', columnClass(index))}
            >
              <span className={cn('font-voice text-3xl tabular-nums', bad ? 'text-bad' : 'text-bone')}>
                {count}
              </span>
              <span className="whitespace-nowrap text-sm text-ash transition-colors group-hover:text-bone group-active:text-bone">
                {figure.label}
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

/** Same boxes as the loaded strip, so nothing moves when the numbers arrive. */
function BriefSkeleton() {
  return (
    <div role="status" aria-label="Loading today’s numbers" className={STRIP}>
      {FIGURES.map((figure, index) => (
        <div key={figure.key} className={columnClass(index)}>
          <span className="flex h-10 items-center">
            <Skeleton className="h-8 w-9" />
          </span>
          <span className="flex h-[1.3125rem] items-center">
            <Skeleton className="h-3.5 w-12" />
          </span>
        </div>
      ))}
    </div>
  )
}

/** Today's brief: calls answered, bookings made, missed calls, tasks finished. */
export function TodayBrief() {
  const query = useBrief()

  return (
    <Section title="Today">
      <QueryView query={query} loading={<BriefSkeleton />} errorTitle="Couldn’t load today’s numbers.">
        {(brief) => <BriefFigures brief={brief} />}
      </QueryView>
    </Section>
  )
}
