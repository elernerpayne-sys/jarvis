import type { Settings, SettingsPatch } from '@/lib/types'
import type { JarvisService } from '@/services/types'

import { getClient } from '../client'
import { SETTINGS_COLUMNS } from '../columns'
import { one } from '../db'

/** No row is visible either before the migrations have run or to an account that is not the owner. */
const NO_SETTINGS = { notFound: 'Couldn’t find your settings. Make sure you’re signed in as the owner.' }

/**
 * The fields the owner may change. Anything else on the object (owner_id
 * above all) is dropped here, whatever the caller passed in.
 */
const EDITABLE: readonly (keyof SettingsPatch)[] = [
  'notify_phone',
  'notification_prefs',
  'quiet_hours_enabled',
  'quiet_hours_start',
  'quiet_hours_end',
  'timezone',
  'allowed_repos',
]

function editableValues(patch: SettingsPatch): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const key of EDITABLE) {
    if (patch[key] !== undefined) values[key] = patch[key]
  }
  if (typeof values.notify_phone === 'string') values.notify_phone = values.notify_phone.trim() || null
  if (Array.isArray(patch.allowed_repos)) {
    values.allowed_repos = [...new Set(patch.allowed_repos.map((repo) => repo.trim()).filter((repo) => repo !== ''))]
  }
  return values
}

function readSettings(): Promise<Settings> {
  return one<Settings>(getClient().from('settings').select(SETTINGS_COLUMNS).limit(1).maybeSingle(), NO_SETTINGS)
}

export const settings: Pick<JarvisService, 'getSettings' | 'updateSettings'> = {
  async getSettings() {
    return readSettings()
  },

  async updateSettings(patch) {
    const values = editableValues(patch)
    if (Object.keys(values).length === 0) return readSettings()
    return one<Settings>(
      getClient()
        .from('settings')
        .update(values)
        // There is exactly one settings row, and row-level security only
        // shows it to the owner. Supabase refuses an UPDATE with no filter,
        // so this one matches every row we are allowed to see.
        .not('id', 'is', null)
        .select(SETTINGS_COLUMNS)
        .single(),
      NO_SETTINGS,
    )
  },
}
