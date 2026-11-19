import { useId, useState } from 'react'

import { formatPhone } from '@/lib/format'
import { Field, Input } from '@/components/ui/Form'
import { Dot } from '@/components/ui/StatusDot'
import { normalizePhone } from '@/features/settings/phone'
import type { SaveSettings } from '@/features/settings/useSettingsEditor'

/**
 * Where Jarvis calls or texts the owner. Saves when the field is left or
 * Enter is pressed, and only if the number actually changed.
 */
export function PhoneField({
  phone,
  needed,
  save,
}: {
  /** The stored number, E.164, or null when there is none. */
  phone: string | null
  /** True when some alert is set to call or text, so a number is required. */
  needed: boolean
  save: SaveSettings
}) {
  const warningId = useId()
  const [draft, setDraft] = useState(() => formatPhone(phone))
  const [error, setError] = useState<string | null>(null)

  // Follow the stored number when it changes under the field: after a save,
  // or when a failed save puts the old number back.
  const [shown, setShown] = useState(phone)
  if (shown !== phone) {
    setShown(phone)
    setDraft(formatPhone(phone))
    setError(null)
  }

  function commit() {
    const result = normalizePhone(draft)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(null)
    if (result.value === phone) {
      // Same number, typed differently: tidy it rather than save it again.
      setDraft(formatPhone(phone))
      return
    }
    save({ notify_phone: result.value })
  }

  const missing = needed && !phone

  return (
    <div className="space-y-2">
      <Field label="Your mobile number" error={error}>
        {(control) => (
          <Input
            {...control}
            aria-describedby={
              [control['aria-describedby'], missing ? warningId : null].filter(Boolean).join(' ') || undefined
            }
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            enterKeyHint="done"
            placeholder="(512) 555-0142"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value)
              setError(null)
            }}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit()
            }}
          />
        )}
      </Field>
      {missing ? (
        <p id={warningId} className="flex items-baseline gap-2 text-sm text-ash">
          <Dot tone="amber" className="-translate-y-px" />
          Add your number so Jarvis can call or text you.
        </p>
      ) : null}
    </div>
  )
}
