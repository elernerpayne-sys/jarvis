import { describe, expect, it } from 'vitest'

import { zoneCity, zoneLabel, zoneOptions } from '@/features/settings/timezones'

describe('time zones', () => {
  it('names a zone by its city', () => {
    expect(zoneCity('America/Chicago')).toBe('Chicago')
    expect(zoneCity('America/Los_Angeles')).toBe('Los Angeles')
    expect(zoneCity('America/Argentina/Buenos_Aires')).toBe('Buenos Aires')
    expect(zoneLabel('America/Chicago')).toBe('Chicago (America/Chicago)')
    expect(zoneLabel('UTC')).toBe('UTC')
  })

  it('offers the saved and device zones once each, alongside the common ones', () => {
    const options = zoneOptions('Asia/Tokyo', 'America/Chicago')
    expect(options).toContain('Asia/Tokyo')
    expect(options.filter((zone) => zone === 'America/Chicago')).toHaveLength(1)
    expect(new Set(options).size).toBe(options.length)
  })

  it('keeps the same order when the saved zone changes between common zones', () => {
    expect(zoneOptions('America/Chicago', 'America/Denver')).toEqual(zoneOptions('Europe/London', 'America/Denver'))
  })

  it('copes with a device that will not say where it is', () => {
    expect(zoneOptions('America/Chicago', null)).toContain('America/Chicago')
  })
})
