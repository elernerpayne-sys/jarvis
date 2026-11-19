/**
 * Time zones for quiet hours. The picker stays short: where the owner is
 * now, what is saved, and the zones a US shop owner is likely to want.
 */

const COMMON_ZONES: readonly string[] = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Mexico_City',
  'Europe/London',
  'Europe/Madrid',
]

/** The zone this device is set to, or null when the browser won't say. */
export function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    return null
  }
}

/** "America/Los_Angeles" → "Los Angeles". */
export function zoneCity(zone: string): string {
  const city = zone.split('/').pop() ?? zone
  return city.replaceAll('_', ' ')
}

/** "America/Chicago" → "Chicago (America/Chicago)". */
export function zoneLabel(zone: string): string {
  const city = zoneCity(zone)
  return city === zone ? zone : `${city} (${zone})`
}

/**
 * The zones to offer. The common ones keep their order so the list does not
 * shuffle when the choice changes; the device's and the saved zone are put
 * first when they are not already among them.
 */
export function zoneOptions(saved: string, device: string | null): string[] {
  const extras = [device, saved].filter((zone): zone is string => Boolean(zone))
  return [...new Set([...extras.filter((zone) => !COMMON_ZONES.includes(zone)), ...COMMON_ZONES])]
}
