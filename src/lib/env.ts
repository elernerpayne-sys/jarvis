/**
 * Build-time configuration. The only values the browser ever sees are the
 * Supabase project URL and its public (publishable / anon) key. Every other
 * secret lives in Supabase edge functions.
 */

function read(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export const SUPABASE_URL = read(import.meta.env.VITE_SUPABASE_URL)

/** Either name works: the newer publishable key or the legacy anon key. */
export const SUPABASE_KEY =
  read(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) || read(import.meta.env.VITE_SUPABASE_ANON_KEY)

/**
 * Demo mode: sample data, no login. It is on ONLY when no Supabase keys are
 * set. As soon as both the URL and a key are present the app is live and
 * everything sits behind sign-in.
 */
export const IS_DEMO = SUPABASE_URL === '' || SUPABASE_KEY === ''
