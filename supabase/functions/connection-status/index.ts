// Entry point. All logic is in handler.ts so it can be tested without a network.
import { denoEnv } from '../_shared/env.ts'
import { liveAuth } from '../_shared/supabase.ts'
import { handleConnectionStatus } from './handler.ts'

const auth = liveAuth(denoEnv)

Deno.serve((request) =>
  handleConnectionStatus(request, { env: denoEnv, fetch, auth, now: () => new Date() }),
)
