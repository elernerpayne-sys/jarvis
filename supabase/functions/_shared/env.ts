/**
 * Environment access.
 *
 * Every handler receives an `Env` function instead of reading `Deno.env`
 * itself, so tests can run without a real environment and nothing reads a
 * secret outside a request.
 */

export type Env = (name: string) => string | undefined

/** The real environment of the edge function. */
export const denoEnv: Env = (name) => Deno.env.get(name)

/**
 * A secret's value, or null when it is unset or blank.
 *
 * Values are trimmed: a trailing newline pasted into `supabase secrets set`
 * is the usual reason a correct key is rejected.
 */
export function secret(env: Env, name: string): string | null {
  const value = env(name)?.trim()
  return value ? value : null
}

/** The names from `names` that are not set, in the order given. */
export function missingSecrets(env: Env, names: readonly string[]): string[] {
  return names.filter((name) => secret(env, name) === null)
}

/** "A", "A and B", "A, B and C". */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * Supabase injects its API keys in two generations:
 *   SUPABASE_PUBLISHABLE_KEYS / SUPABASE_SECRET_KEYS   JSON, {"default":"sb_…"}
 *   SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY      legacy JWT keys
 * Read the new form first and fall back to the old one.
 */
function pickKey(env: Env, pluralVar: string, ...singleVars: string[]): string | null {
  const plural = secret(env, pluralVar)
  if (plural) {
    try {
      const parsed: unknown = JSON.parse(plural)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>
        const value = record.default ?? Object.values(record)[0]
        if (typeof value === 'string' && value.trim()) return value.trim()
      }
    } catch {
      // Malformed JSON: fall through to the single-key variables.
    }
  }
  for (const name of singleVars) {
    const value = secret(env, name)
    if (value) return value
  }
  return null
}

export function supabaseUrl(env: Env): string | null {
  return secret(env, 'SUPABASE_URL')
}

/** Public key. Safe to pair with a user's token: row-level security applies. */
export function publicKey(env: Env): string | null {
  return pickKey(env, 'SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY')
}

/** Privileged key. Bypasses row-level security. Never leaves the server. */
export function adminKey(env: Env): string | null {
  return pickKey(env, 'SUPABASE_SECRET_KEYS', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY')
}
