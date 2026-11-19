// Entry point. All logic is in handler.ts so it can be tested without a network.
// Not called with a user session: config.toml sets verify_jwt = false and the
// handler verifies the X-Jarvis-Signature HMAC before anything else.
import { denoEnv } from '../_shared/env.ts'
import { liveDb } from '../_shared/supabase.ts'
import { handleWebhook, ReplayGuard } from './handler.ts'

const db = liveDb(denoEnv)
const replay = new ReplayGuard()

Deno.serve((request) => handleWebhook(request, { env: denoEnv, db, now: () => new Date(), replay }))
