/** Checks made before anything is sent, so obvious slips get an instant answer. */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Returns what is wrong with the email, or null when it looks right. */
export function emailProblem(email: string): string | null {
  const text = email.trim()
  if (text === '') return 'Enter your email.'
  if (!EMAIL.test(text)) return 'That doesn’t look like an email address.'
  return null
}

export function passwordProblem(password: string): string | null {
  return password === '' ? 'Enter your password.' : null
}

export const CODE_LENGTH = 6

export function codeProblem(code: string): string | null {
  if (code === '') return 'Enter the code from the email.'
  if (!/^\d{6}$/.test(code)) return 'The code is 6 digits.'
  return null
}

/** Keeps only digits, so a pasted "123 456" or "123-456" still works. */
export function digitsOnly(text: string): string {
  return text.replace(/\D/g, '').slice(0, CODE_LENGTH)
}
