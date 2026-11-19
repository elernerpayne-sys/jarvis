/**
 * Build-time configuration: which backend the app talks to.
 *
 * Three ways to run, checked in this order:
 *   1. VITE_JARVIS_API_URL is set → the app talks straight to your own Jarvis
 *      backend (services/jarvis, contract in docs/app-api.md). Your backend
 *      holds every secret; the browser only ever sees its address.
 *      "same-origin" means the backend is the site the app is served from
 *      (the Jarvis server in server/ does this), so requests go to /app/….
 *   2. Otherwise, the Supabase URL and public key are both set → the app talks
 *      to Supabase (services/live, contract in docs/backend.md).
 *   3. Otherwise → demo mode: sample data, no sign-in.
 *
 * Every value here is public by design. Never put a secret in a VITE_ variable.
 */

function read(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** What VITE_JARVIS_API_URL says: an address, "same-origin", or nothing. */
export const JARVIS_API_SETTING = read(import.meta.env.VITE_JARVIS_API_URL)

/**
 * The base every request starts with. "same-origin" (or "/") becomes "", so
 * requests go to this site's own /app/…; an address loses its trailing slash.
 */
export function jarvisBaseUrl(setting: string): string {
  const value = setting.trim()
  if (value.toLowerCase() === 'same-origin' || /^\/+$/.test(value)) return ''
  return value.replace(/\/+$/, '')
}

/** Your Jarvis backend's address, e.g. "https://jarvis.example.com", without a trailing slash ("" for same-origin). */
export const JARVIS_API_URL = jarvisBaseUrl(JARVIS_API_SETTING)

export const SUPABASE_URL = read(import.meta.env.VITE_SUPABASE_URL)

/** Any of these names works: the newer publishable key or the legacy anon key. */
export const SUPABASE_KEY =
  read(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) ||
  read(import.meta.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY) ||
  read(import.meta.env.VITE_SUPABASE_ANON_KEY)

export type BackendKind = 'jarvis' | 'supabase' | 'demo'

/** Picks the backend from the values above. Kept pure so it can be tested. */
export function chooseBackend(config: { jarvisUrl: string; supabaseUrl: string; supabaseKey: string }): BackendKind {
  if (config.jarvisUrl.trim() !== '') return 'jarvis'
  if (config.supabaseUrl.trim() !== '' && config.supabaseKey.trim() !== '') return 'supabase'
  return 'demo'
}

export const BACKEND: BackendKind = chooseBackend({
  jarvisUrl: JARVIS_API_SETTING,
  supabaseUrl: SUPABASE_URL,
  supabaseKey: SUPABASE_KEY,
})

/**
 * Demo mode: sample data, no login. It is on ONLY when nothing is configured.
 * As soon as a Jarvis backend address (or both Supabase values) is set, the
 * app is live and everything sits behind sign-in.
 */
export const IS_DEMO = BACKEND === 'demo'
