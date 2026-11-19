import { useState } from 'react'

import { TalkPanel } from '@/features/voice'
import { AlertsSheet } from '@/features/home/AlertsSheet'
import { HomeHeader } from '@/features/home/HomeHeader'
import { PendingApprovals } from '@/features/home/PendingApprovals'
import { TodayBrief } from '@/features/home/TodayBrief'

/**
 * Home: the greeting, the Talk button, today's numbers and whatever is
 * waiting on the owner.
 *
 * On a phone it is one column and the Talk button owns the first screenful;
 * the numbers start at the bottom edge. On a desktop the Talk button stays
 * put on the left while the numbers and approvals scroll beside it.
 */
export default function Home() {
  const [alertsOpen, setAlertsOpen] = useState(false)

  return (
    <div className="mx-auto w-full max-w-[45rem] px-5 pb-12 pt-6 lg:max-w-5xl lg:pt-10">
      <HomeHeader onOpenAlerts={() => setAlertsOpen(true)} />

      <div className="lg:mt-8 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-12">
        {/* The hero. The height keeps it centred in the first screenful on a
            phone, whatever the panel's own size; taller content just grows. */}
        <div className="flex min-h-[calc(100svh-23.5rem)] flex-col justify-center py-8 lg:sticky lg:top-10 lg:min-h-[calc(100svh-13rem)] lg:py-0">
          <TalkPanel />
        </div>

        <div className="space-y-10">
          <TodayBrief />
          <PendingApprovals />
        </div>
      </div>

      <AlertsSheet open={alertsOpen} onClose={() => setAlertsOpen(false)} />
    </div>
  )
}
