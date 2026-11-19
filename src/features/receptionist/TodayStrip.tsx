import { cn } from '@/lib/cn'
import type { ShopSummary } from '@/lib/types'
import { Section } from '@/components/ui/Page'

/**
 * Today's calls, bookings and missed calls for one shop: one hairline strip,
 * the same ledger line as the brief on Home.
 */
export function TodayStrip({ shop }: { shop: ShopSummary }) {
  const figures = [
    { label: 'Calls', count: shop.calls_today, bad: false },
    { label: 'Booked', count: shop.bookings_today, bad: false },
    // Anything above zero here is a problem and shows in red.
    { label: 'Missed', count: shop.missed_today, bad: shop.missed_today > 0 },
  ]

  return (
    <Section title="Today">
      {/* Read out as a whole when a new call changes the numbers. */}
      <dl
        aria-live="polite"
        aria-atomic="true"
        className="grid grid-cols-3 divide-x divide-line border-y border-line"
      >
        {figures.map((figure, index) => (
          // Number above its label on screen; label first for screen readers.
          <div key={figure.label} className={cn('flex flex-col-reverse gap-1 py-4', index > 0 && 'pl-4')}>
            <dt className="text-sm text-ash">{figure.label}</dt>
            <dd className={cn('font-voice text-3xl tabular-nums', figure.bad ? 'text-bad' : 'text-bone')}>
              {figure.count}
            </dd>
          </div>
        ))}
      </dl>
    </Section>
  )
}
