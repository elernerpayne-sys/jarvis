import { ALERT_TYPE_HINT, ALERT_TYPE_LABEL, CHANNEL_LABEL } from '@/lib/status'
import { ALERT_TYPES, NOTIFY_CHANNELS } from '@/lib/types'
import type { NotificationPrefs, NotifyChannel } from '@/lib/types'
import { Segmented } from '@/components/ui/Form'
import type { SegmentedOption } from '@/components/ui/Form'
import { List } from '@/components/ui/List'
import type { SaveSettings } from '@/features/settings/useSettingsEditor'

const CHANNEL_OPTIONS: ReadonlyArray<SegmentedOption<NotifyChannel>> = NOTIFY_CHANNELS.map((channel) => ({
  value: channel,
  label: CHANNEL_LABEL[channel],
}))

/** One row per kind of alert: call me, text me, or keep it in the app. */
export function AlertChannels({ prefs, save }: { prefs: NotificationPrefs; save: SaveSettings }) {
  return (
    <List label="How Jarvis reaches you for each alert">
      {ALERT_TYPES.map((type) => (
        <li key={type} className="py-4 sm:flex sm:items-center sm:justify-between sm:gap-6">
          <div className="min-w-0">
            <p className="text-base text-bone">{ALERT_TYPE_LABEL[type]}</p>
            <p className="mt-0.5 text-sm text-ash">{ALERT_TYPE_HINT[type]}</p>
          </div>
          <Segmented
            label={ALERT_TYPE_LABEL[type]}
            value={prefs[type]}
            options={CHANNEL_OPTIONS}
            // The backend stores the preferences as one object, so send all of it.
            onChange={(channel) => save({ notification_prefs: { ...prefs, [type]: channel } })}
            className="mt-3 sm:mt-0 sm:w-80 sm:shrink-0"
          />
        </li>
      ))}
    </List>
  )
}
