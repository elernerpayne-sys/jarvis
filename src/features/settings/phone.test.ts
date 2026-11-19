import { describe, expect, it } from 'vitest'

import { normalizePhone } from '@/features/settings/phone'

describe('normalizePhone', () => {
  it('assumes +1 when ten digits are typed without a country code', () => {
    expect(normalizePhone('5125550142')).toEqual({ ok: true, value: '+15125550142' })
    expect(normalizePhone('(512) 555-0142')).toEqual({ ok: true, value: '+15125550142' })
    expect(normalizePhone('512 555 0142')).toEqual({ ok: true, value: '+15125550142' })
  })

  it('keeps a country code that was typed', () => {
    expect(normalizePhone('+1 (512) 555-0142')).toEqual({ ok: true, value: '+15125550142' })
    expect(normalizePhone('1 512 555 0142')).toEqual({ ok: true, value: '+15125550142' })
    expect(normalizePhone('+44 20 7946 0000')).toEqual({ ok: true, value: '+442079460000' })
    expect(normalizePhone('+52 55 1234 5678')).toEqual({ ok: true, value: '+525512345678' })
  })

  it('treats an empty field as no number', () => {
    expect(normalizePhone('')).toEqual({ ok: true, value: null })
    expect(normalizePhone('   ')).toEqual({ ok: true, value: null })
  })

  it('rejects anything that is not a phone number', () => {
    for (const input of ['call me', '512-555-0142 ext 4', '512.555.0142', '55+5125550142']) {
      expect(normalizePhone(input), input).toMatchObject({ ok: false })
    }
  })

  it('rejects numbers of the wrong length', () => {
    for (const input of ['555-0142', '+1 512 555 014', '+1 512 555 01422', '+0 123 456 7890', '+', '+1234567890123456']) {
      expect(normalizePhone(input), input).toMatchObject({ ok: false })
    }
  })

  it('asks for the country code when it cannot guess one', () => {
    const result = normalizePhone('442079460000')
    expect(result).toMatchObject({ ok: false })
    expect(result.ok ? '' : result.error).toMatch(/country code/)
  })
})
