/**
 * The single entry point for data. Import `api` and nothing else.
 *
 * Demo mode (no Supabase keys) gets the in-memory sample service. Otherwise
 * the app talks to Supabase. To put another backend behind the app, return a
 * different `JarvisService` here.
 */
import { IS_DEMO } from '@/lib/env'
import { createDemoService } from '@/services/demo'
import { createLiveService } from '@/services/live'
import type { JarvisService } from '@/services/types'

export const api: JarvisService = IS_DEMO ? createDemoService() : createLiveService()

export type { AuthApi, AuthUser, JarvisService } from '@/services/types'
export { ServiceError, errorMessage, isNotFound, isServiceError } from '@/services/errors'
