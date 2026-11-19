import { Link, useParams } from 'react-router'

import { formatPhone } from '@/lib/format'
import { routes } from '@/lib/links'
import type { ShopSummary } from '@/lib/types'
import { errorMessage, isNotFound } from '@/services/errors'
import { useCalls, useShop, useUpcomingAppointments } from '@/services/hooks'
import { buttonClass } from '@/components/ui/Button'
import { Page } from '@/components/ui/Page'
import { ErrorState, Skeleton, SkeletonRows } from '@/components/ui/States'
import { StatusDot } from '@/components/ui/StatusDot'
import { useListedShop } from '@/features/receptionist/cache'
import { CallSheet } from '@/features/receptionist/CallSheet'
import { CallsSection } from '@/features/receptionist/CallsSection'
import { TodayStrip } from '@/features/receptionist/TodayStrip'
import { UpcomingAppointments } from '@/features/receptionist/UpcomingAppointments'
import { useCallParams } from '@/features/receptionist/useCallParams'

const BACK = { to: routes.receptionist, label: 'Receptionist' }

/** Under the shop's name: the line Jarvis answers, and where the shop is. */
function ShopContact({ shop }: { shop: ShopSummary }) {
  return (
    <>
      <span className="block tabular-nums">{formatPhone(shop.phone)}</span>
      {shop.address ? <span className="block">{shop.address}</span> : null}
      {shop.status === 'paused' ? <StatusDot label="Paused" tone="neutral" className="mt-2" /> : null}
    </>
  )
}

function ShopMissing() {
  return (
    <Page back={BACK} title="This shop doesn’t exist">
      <div className="space-y-5">
        <p className="text-base text-ash">It may have been removed, or the link is out of date.</p>
        <Link to={routes.receptionist} className={buttonClass({ variant: 'secondary' })}>
          See all shops
        </Link>
      </div>
    </Page>
  )
}

/**
 * Stands in for the whole screen until the shop's name is known. It repeats
 * `<Page>`'s frame by hand, because `<Page>` needs its title as text.
 */
function ShopSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[45rem] px-5 pb-12 pt-6 lg:pt-10">
      <div className="mb-2 flex h-11 items-center">
        <Skeleton className="h-4 w-24" />
      </div>
      <Skeleton className="h-8 w-56 max-w-full" />
      <Skeleton className="mt-3 h-4 w-32" />
      <Skeleton className="mt-2 h-4 w-48" />
      <div className="mt-10">
        <SkeletonRows count={5} label="Loading shop" />
      </div>
    </div>
  )
}

/** One barbershop: today's numbers, what is booked, and every call Jarvis took. */
export function ShopScreen() {
  const { shopId = '' } = useParams()
  const { filter, callId, setFilter, openCall, closeCall } = useCallParams()

  // All three load side by side, so the lists are not held up by the shop.
  const shopQuery = useShop(shopId)
  const appointments = useUpcomingAppointments(shopId)
  const calls = useCalls(shopId, filter)

  // Coming from the list, its row has everything the header needs: use that
  // until the shop itself answers (unless the answer is that it is gone).
  const listed = useListedShop(shopId)
  const shop = shopQuery.data ?? (shopQuery.isError ? undefined : listed)

  if (!shop) {
    if (isNotFound(shopQuery.error)) return <ShopMissing />
    if (shopQuery.isError) {
      return (
        <Page back={BACK} title="Shop">
          <ErrorState
            title="Couldn’t load this shop."
            message={errorMessage(shopQuery.error, 'Check your connection and try again.')}
            onRetry={() => void shopQuery.refetch()}
            retrying={shopQuery.isFetching}
          />
        </Page>
      )
    }
    return <ShopSkeleton />
  }

  return (
    <>
      <Page back={BACK} title={shop.name} subtitle={<ShopContact shop={shop} />}>
        <TodayStrip shop={shop} />
        {/* Keyed by shop so "Show all" does not carry over from another shop. */}
        <UpcomingAppointments key={`appointments-${shop.id}`} query={appointments} />
        <CallsSection
          key={`calls-${shop.id}`}
          query={calls}
          filter={filter}
          onFilterChange={setFilter}
          onOpenCall={openCall}
        />
      </Page>
      <CallSheet callId={callId} onClose={closeCall} />
    </>
  )
}
