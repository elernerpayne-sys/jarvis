import { plural } from '@/lib/format'
import { routes } from '@/lib/links'
import type { ShopSummary } from '@/lib/types'
import { useShops } from '@/services/hooks'
import { List, ListRow } from '@/components/ui/List'
import { Page } from '@/components/ui/Page'
import { EmptyState, QueryView, Skeleton, SkeletonRows } from '@/components/ui/States'
import { StatusDot } from '@/components/ui/StatusDot'
import { todaySentence } from '@/features/receptionist/lib'

function ShopRow({ shop }: { shop: ShopSummary }) {
  return (
    <ListRow
      to={routes.shop(shop.id)}
      title={shop.name}
      subtitle={shop.address}
      trailing={
        <>
          <span className="block">{plural(shop.calls_today, 'call')}</span>
          <span className="block">{shop.bookings_today} booked</span>
          {shop.missed_today > 0 ? <span className="block text-bad">{shop.missed_today} missed</span> : null}
        </>
      }
    >
      {shop.status === 'paused' ? <StatusDot label="Paused" tone="neutral" className="mt-1" /> : null}
    </ListRow>
  )
}

function ShopsSkeleton() {
  return (
    <div className="space-y-6">
      <span className="flex h-7 items-center">
        <Skeleton className="h-5 w-64 max-w-full" />
      </span>
      <SkeletonRows count={3} label="Loading shops" />
    </div>
  )
}

/** Every barbershop Jarvis answers for, with today's numbers. */
export function ShopsScreen() {
  const query = useShops()

  return (
    <Page title="Receptionist">
      <QueryView
        query={query}
        loading={<ShopsSkeleton />}
        errorTitle="Couldn’t load your shops."
        isEmpty={(shops) => shops.length === 0}
        empty={
          <EmptyState title="No shops yet." body="Shops appear here once Jarvis is answering their phones." />
        }
      >
        {(shops) => (
          <div className="space-y-6">
            {/* Jarvis reporting on the day, so it is set in the voice typeface. */}
            <p aria-live="polite" className="font-voice text-xl text-bone">
              {todaySentence(shops)}
            </p>
            <List label="Shops">
              {shops.map((shop) => (
                <ShopRow key={shop.id} shop={shop} />
              ))}
            </List>
          </div>
        )}
      </QueryView>
    </Page>
  )
}
