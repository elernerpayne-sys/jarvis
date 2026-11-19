/**
 * The owner's mobile number, as typed, turned into the form the backend
 * dials: "+" followed by digits (E.164).
 */

export type PhoneResult =
  | { ok: true; value: string | null }
  | { ok: false; error: string }

const EXAMPLE = '+1 512 555 0142'

/**
 * "(512) 555-0142" → "+15125550142". Ten digits with no country code are
 * taken as a US or Canadian number. An empty field means "no number".
 */
export function normalizePhone(input: string): PhoneResult {
  const text = input.trim()
  if (text === '') return { ok: true, value: null }

  if (!/^\+?[\d\s()-]+$/.test(text)) {
    return { ok: false, error: `Use only digits, spaces and dashes, like ${EXAMPLE}.` }
  }

  const digits = text.replace(/\D/g, '')
  const hasCountryCode = text.startsWith('+')

  if (!hasCountryCode) {
    if (digits.length === 10) return { ok: true, value: `+1${digits}` }
    if (digits.length === 11 && digits.startsWith('1')) return { ok: true, value: `+${digits}` }
    return { ok: false, error: `Add the country code, like ${EXAMPLE}.` }
  }

  // E.164: no leading zero, 15 digits at most. Country code 1 is always 11.
  const plausible = digits.startsWith('1')
    ? digits.length === 11
    : /^[2-9]\d{7,14}$/.test(digits)
  if (!plausible) {
    return { ok: false, error: `That number is not the right length. It should look like ${EXAMPLE}.` }
  }
  return { ok: true, value: `+${digits}` }
}
