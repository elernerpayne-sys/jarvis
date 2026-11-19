/**
 * The one Supabase client for the whole app.
 *
 * It is built on first use, not at import time. `createClient` throws on a
 * mistyped project URL, and that has to reach the owner as a sentence on the
 * sign-in screen instead of a blank page while the app is still loading.
 */
import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

import { SUPABASE_KEY, SUPABASE_URL } from '@/lib/env'
import { ServiceError } from '@/services/errors'

/** How long a read or write may hang before it counts as "couldn't reach Jarvis". */
const DB_TIMEOUT_MS = 15_000

let client: SupabaseClient | null = null

export function getClient(): SupabaseClient {
  if (client) return client

  if (SUPABASE_URL === '' || SUPABASE_KEY === '') {
    throw new ServiceError(
      'not_configured',
      'Supabase isn’t connected yet. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to .env, then restart the app.',
    )
  }

  try {
    client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        // An installed app should stay signed in between launches.
        persistSession: true,
        autoRefreshToken: true,
        // A sign-in link opened from an email arrives with the session in the
        // URL. Typed codes and passwords never need this; it costs nothing.
        detectSessionInUrl: true,
      },
      db: {
        timeout: DB_TIMEOUT_MS,
        // supabase-js would retry failed reads for about seven seconds on its
        // own. TanStack Query already retries, and stacking the two keeps a
        // skeleton on screen long after the phone has lost its connection.
        retry: false,
      },
    })
  } catch (cause) {
    throw new ServiceError(
      'not_configured',
      'The Supabase URL in .env isn’t valid. It should look like https://your-project.supabase.co.',
      { cause },
    )
  }

  return client
}
