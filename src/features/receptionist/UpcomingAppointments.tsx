import { useState } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'

import { formatDay, formatTime } from '@/lib/format'
import { APPOINTMENT_STATUS } from '@/lib/status'
import type { Appointment } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { List, ListRow } from '@/components/ui/List'
import { Section } from '@/components/ui/Page'
import { EmptyState, QueryView, SkeletonRows } from '@/components/ui/States'
import { StatusDot } from '@/components/ui/StatusDot'
import { groupByDay } from '@/features/receptionist/lib'
import { useNow } from '@/features/receptionist/useNow'

/** How many appointments show before "Show all". */
const PREVIEW_COUNT = 6

function AppointmentRow({ appointment }: { appointment: Appointment }) {
  const { service, barber, status } = appointment
  return (
    <ListRow
      leading={
        // Pulled up onto the customer's line (the row pads its leading slot for icons).
        <time dateTime={appointment.starts_at} className="-mt-1 w-[4.5rem] text-sm leading-6 text-bone tabular-nums">
          {formatTime(appointment.starts_at)}
        </time>
      }
      title={appointment.customer_name}
      subtitle={barber ? `${service} with ${barber}` : service}
      // A plain booking is the normal case; only say so when it is something else.
      trailing={status === 'booked' ? undefined : <StatusDot {...APPOINTMENT_STATUS[status]} />}
    />
  )
}

function AppointmentDays({ appointments }: { appointments: Appointment[] }) {
  const now = useNow()
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? appointments : appointments.slice(0, PREVIEW_COUNT)
  const days = groupByDay(visible, (appointment) => appointment.starts_at)

  return (
    <div className="space-y-5">
      {days.map((group) => (
        <div key={group.day}>
          <h3 className="pb-2 text-sm text-ash">{formatDay(group.at, now)}</h3>
          <List>
            {group.items.map((appointment) => (
              <AppointmentRow key={appointment.id} appointment={appointment} />
            ))}
          </List>
        </div>
      ))}
      {appointments.length > PREVIEW_COUNT ? (
        <Button
          variant="ghost"
          className="-ml-4"
          aria-expanded={showAll}
          onClick={() => setShowAll((current) => !current)}
        >
          {showAll ? 'Show fewer' : `Show all ${appointments.length}`}
        </Button>
      ) : null}
    </div>
  )
}

/** What is on the books from now on, a day at a time. */
export function UpcomingAppointments({ query }: { query: UseQueryResult<Appointment[]> }) {
  return (
    <Section title="Upcoming appointments">
      <QueryView
        query={query}
        loading={<SkeletonRows count={3} label="Loading appointments" />}
        errorTitle="Couldn’t load appointments."
        isEmpty={(appointments) => appointments.length === 0}
        empty={<EmptyState title="No upcoming appointments." />}
      >
        {(appointments) => <AppointmentDays appointments={appointments} />}
      </QueryView>
    </Section>
  )
}
