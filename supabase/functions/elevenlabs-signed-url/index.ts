// Entry point. All logic is in handler.ts so it can be tested without a network.
import { denoEnv } from '../_shared/env.ts'
import { liveAuth } from '../_shared/supabase.ts'
import { handleSignedUrl } from './handler.ts'

const auth = liveAuth(denoEnv)

Deno.serve((request) => handleSignedUrl(request, { env: denoEnv, fetch, auth }))
