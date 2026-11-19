// Entry point. All logic is in handler.ts so it can be tested without a network.
import { denoEnv } from '../_shared/env.ts'
import { liveAuth, liveDb } from '../_shared/supabase.ts'
import { handleCommand } from './handler.ts'

const auth = liveAuth(denoEnv)
const db = liveDb(denoEnv)

Deno.serve((request) => handleCommand(request, { env: denoEnv, fetch, auth, db }))
