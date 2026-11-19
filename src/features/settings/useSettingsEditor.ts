import { useRef, useState } from 'react'

import type { Settings, SettingsPatch } from '@/lib/types'
import { errorMessage } from '@/services/errors'
import { useUpdateSettings } from '@/services/hooks'
import { useToast } from '@/components/ui/Toast'

type Field = keyof SettingsPatch

/**
 * Saves one change. Fields that already hold the given value are left out,
 * and nothing is sent when nothing is left.
 */
export type SaveSettings = (patch: SettingsPatch, options?: { done?: string }) => void

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Deep equality for the plain values a settings field can hold. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => sameValue(item, b[index]))
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a)
    return keys.length === Object.keys(b).length && keys.every((key) => sameValue(a[key], b[key]))
  }
  return false
}

function changedFields(current: Settings, patch: SettingsPatch): SettingsPatch {
  const entries = Object.entries(patch).filter(
    ([field, value]) => value !== undefined && !sameValue(current[field as Field], value),
  )
  return Object.fromEntries(entries)
}

function without(patch: SettingsPatch, fields: readonly Field[]): SettingsPatch {
  return Object.fromEntries(Object.entries(patch).filter(([field]) => !fields.includes(field as Field)))
}

/**
 * Settings save themselves. A change shows at once, is sent on its own, and
 * is confirmed with a toast; if the save fails the control goes back to what
 * is really stored and the toast says why.
 *
 * Returns the settings as they should appear right now (stored values with
 * unconfirmed changes on top) and the function that saves a change.
 */
export function useSettingsEditor(stored: Settings): { settings: Settings; save: SaveSettings } {
  const update = useUpdateSettings()
  const toast = useToast()

  // Changes that have been sent but not confirmed yet. The ref is the same
  // value, readable straight away, so two saves in a row can't both think
  // they are the first.
  const [unconfirmed, setUnconfirmedState] = useState<SettingsPatch>({})
  const unconfirmedRef = useRef<SettingsPatch>(unconfirmed)
  function setUnconfirmed(next: SettingsPatch) {
    unconfirmedRef.current = next
    setUnconfirmedState(next)
  }

  // Which save last touched each field, so an older save finishing
  // can't undo a newer change to the same control.
  const lastSaveOf = useRef(new Map<Field, number>())
  const saveCount = useRef(0)

  // Saves go out one at a time, in the order they were made. Sent side by
  // side, an older answer could arrive last and overwrite a newer one.
  const queue = useRef<Promise<void>>(Promise.resolve())

  const save: SaveSettings = (patch, options) => {
    const changed = changedFields({ ...stored, ...unconfirmedRef.current }, patch)
    const fields = Object.keys(changed) as Field[]
    if (fields.length === 0) return

    const saveId = ++saveCount.current
    for (const field of fields) lastSaveOf.current.set(field, saveId)
    setUnconfirmed({ ...unconfirmedRef.current, ...changed })

    queue.current = queue.current
      .then(() => update.mutateAsync(changed))
      .then(
        () => toast(options?.done ?? 'Saved', { tone: 'ok', duration: 2000 }),
        (error: unknown) =>
          toast(errorMessage(error, 'Couldn’t save that. Check your connection and try again.'), { tone: 'bad' }),
      )
      .finally(() => {
        // By now the stored settings hold the answer (the new value, or the
        // old one after a failure), so the stand-in can go.
        const settled = fields.filter((field) => lastSaveOf.current.get(field) === saveId)
        for (const field of settled) lastSaveOf.current.delete(field)
        setUnconfirmed(without(unconfirmedRef.current, settled))
      })
  }

  return { settings: { ...stored, ...unconfirmed }, save }
}
