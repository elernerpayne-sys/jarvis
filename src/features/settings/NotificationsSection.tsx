import { DEFAULT_NOTIFICATION_PREFS } from '@/lib/types'
import type { Settings } from '@/lib/types'
import { Section } from '@/components/ui/Page'
import { AlertChannels } from '@/features/settings/AlertChannels'
import { PhoneField } from '@/features/settings/PhoneField'
import { QuietHours } from '@/features/settings/QuietHours'
import type { SaveSettings } from '@/features/settings/useSettingsEditor'

/** How Jarvis reaches the owner: the number, a channel per alert, quiet hours. */
export function NotificationsSection({ settings, save }: { settings: Settings; save: SaveSettings }) {
  // A row saved before a new alert type existed may be missing that type.
  const prefs = { ...DEFAULT_NOTIFICATION_PREFS, ...settings.notification_prefs }
  const needsNumber = Object.values(prefs).some((channel) => channel !== 'in_app')

  return (
    <Section title="Notifications">
      <p className="-mt-2 mb-6 text-sm text-ash">How Jarvis reaches you.</p>
      <div className="space-y-8">
        <PhoneField phone={settings.notify_phone} needed={needsNumber} save={save} />
        <AlertChannels prefs={prefs} save={save} />
        <QuietHours settings={settings} save={save} />
      </div>
    </Section>
  )
}
