/**
 * The live service: Jarvis on Supabase.
 *
 *   client.ts     the one Supabase client
 *   auth.ts       sign-in for the owner
 *   queries/      reads and the few writes the app may make itself, through
 *                 row-level security
 *   functions.ts  everything that needs a secret, through edge functions
 *   realtime.ts   live changes
 *   errors.ts     every failure, turned into a ServiceError
 *
 * The tables, RPCs and functions it expects are described in docs/backend.md.
 */
import type { JarvisService } from '@/services/types'

import { auth } from './auth'
import { edgeFunctions } from './functions'
import { code } from './queries/code'
import { home } from './queries/home'
import { memory } from './queries/memory'
import { receptionist } from './queries/receptionist'
import { settings } from './queries/settings'
import { subscribe } from './realtime'

export function createLiveService(): JarvisService {
  return {
    mode: 'live',
    auth,
    ...home,
    ...receptionist,
    ...code,
    ...memory,
    ...settings,
    ...edgeFunctions,
    subscribe,
  }
}
