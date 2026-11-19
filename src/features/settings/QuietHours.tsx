import { useEffect, useEffectEvent, useState } from 'react'

import { formatClock, isWithinQuietHours } from '@/lib/format'
import type { Settings } from '@/lib/types'
import { Field, Input, Select, Switch } from '@/components/ui/Form'
import { Dot } from '@/components/ui/StatusDot'
import { deviceTimeZone, zoneCity, zoneLabel, zoneOptions } from '@/features/settings/timezones'
import { useNow } from '@/features/settings/useNow'
import type { SaveSettings } from '@/features/settings/useSettingsEditor'

/** How long a time must sit unchanged before it saves by itself. */
const SETTLE_MS = 700

const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/

/** Stored times are "HH:MM"; a database `time` may come back with seconds. */
function toClockTime(value: string): string {
  return value.slice(0, 5)
}

/**
 * A time of day. A phone's picker reports every notch of the wheel, so the
 * value is saved once it stops changing, or straight away on leaving the field.
 */
function TimeField({
  label,
  value,
  onCommit,
}: {
  label: string
  /** The stored time, "HH:MM". */
  value: string
  onCommit: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)

  // Follow the stored time when it changes under the field (a failed save
  // puts the old time back).
  const [shown, setShown] = useState(value)
  if (shown !== value) {
    setShown(value)
    setDraft(value)
  }

  const ready = CLOCK_TIME.test(draft) && draft !== value

  const commitSettled = useEffectEvent(() => onCommit(draft))
  useEffect(() => {
    if (!ready) return
    const timer = setTimeout(() => commitSettled(), SETTLE_MS)
    return () => clearTimeout(timer)
  }, [ready, draft])

  function handleBlur() {
    if (ready) onCommit(draft)
    // A field left half-filled goes back to the stored time.
    else if (!CLOCK_TIME.test(draft)) setDraft(value)
  }

  return (
    <Field label={label}>
      {(control) => (
        <Input
          {...control}
          type="time"
          // Required, so a phone's picker offers no "Clear" button.
          required
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={handleBlur}
          className="min-w-0 tabular-nums"
        />
      )}
    </Field>
  )
}

/** Quiet hours: when calls and texts are held back, and in which time zone. */
export function QuietHours({ settings, save }: { settings: Settings; save: SaveSettings }) {
  const now = useNow()
  const enabled = settings.quiet_hours_enabled
  const start = toClockTime(settings.quiet_hours_start)
  const end = toClockTime(settings.quiet_hours_end)
  const zone = settings.timezone
  const deviceZone = deviceTimeZone()

  return (
    <div>
      <Switch
        label="Quiet hours"
        hint="Calls and texts wait in the app until quiet hours end."
        checked={enabled}
        onChange={(checked) => save({ quiet_hours_enabled: checked })}
      />

      {enabled ? (
        <div className="mt-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <TimeField label="From" value={start} onCommit={(value) => save({ quiet_hours_start: value })} />
            <TimeField label="Until" value={end} onCommit={(value) => save({ quiet_hours_end: value })} />
          </div>

          <div>
            <Field label="Time zone">
              {(control) => (
                <Select {...control} value={zone} onChange={(event) => save({ timezone: event.target.value })}>
                  {zoneOptions(zone, deviceZone).map((option) => (
                    <option key={option} value={option}>
                      {zoneLabel(option)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {deviceZone && deviceZone !== zone ? (
              <button
                type="button"
                onClick={() => save({ timezone: deviceZone })}
                className="mt-1 inline-flex min-h-12 items-center rounded-xl text-left text-sm text-ash underline decoration-line-strong underline-offset-4 hover:text-bone"
              >
                Use this phone’s time zone ({deviceZone})
              </button>
            ) : null}
          </div>

          <div aria-live="polite" className="space-y-1 text-sm text-ash">
            {start === end ? (
              <p>From and Until are the same time, so quiet hours never start.</p>
            ) : (
              <p>
                Quiet from {formatClock(start)} to {formatClock(end)}, {zoneCity(zone)} time.
              </p>
            )}
            {isWithinQuietHours(start, end, zone, now) ? (
              <p className="flex items-baseline gap-2">
                <Dot tone="amber" className="-translate-y-px" />
                Quiet hours are on right now.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
