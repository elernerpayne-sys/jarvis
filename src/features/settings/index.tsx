import type { Settings } from '@/lib/types'
import { useSettings } from '@/services/hooks'
import { Page, Section } from '@/components/ui/Page'
import { QueryView, Skeleton, SkeletonRows } from '@/components/ui/States'
import { AccountSection } from '@/features/settings/AccountSection'
import { ConnectionsSection } from '@/features/settings/ConnectionsSection'
import { InstallSection } from '@/features/settings/InstallSection'
import { NotificationsSection } from '@/features/settings/NotificationsSection'
import { ReposSection } from '@/features/settings/ReposSection'
import { useSettingsEditor } from '@/features/settings/useSettingsEditor'

/** Stands in for the two sections that come from the stored settings. */
function PreferencesSkeleton() {
  return (
    <>
      <Section title="Notifications">
        <p className="-mt-2 mb-6 text-sm text-ash">How Jarvis reaches you.</p>
        <div className="space-y-8">
          <div className="space-y-2">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-12 w-full rounded-xl" />
          </div>
          <SkeletonRows count={3} label="Loading notification settings" />
          <div className="flex items-center justify-between gap-4">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-8 w-14 rounded-full" />
          </div>
        </div>
      </Section>
      <Section title="Repos Jarvis can work in">
        <SkeletonRows count={2} label="Loading repos" />
      </Section>
    </>
  )
}

function Preferences({ stored }: { stored: Settings }) {
  const { settings, save } = useSettingsEditor(stored)
  return (
    <>
      <NotificationsSection settings={settings} save={save} />
      <ReposSection repos={settings.allowed_repos} save={save} />
    </>
  )
}

/** Settings: what Jarvis is connected to, how it reaches you, where it may work. */
export default function SettingsScreen() {
  const settings = useSettings()

  return (
    <Page title="Settings">
      <ConnectionsSection />
      <QueryView query={settings} loading={<PreferencesSkeleton />} errorTitle="Couldn’t load your settings.">
        {(stored) => <Preferences stored={stored} />}
      </QueryView>
      <InstallSection />
      <AccountSection />
    </Page>
  )
}
