/**
 * The single entry point for data. Import `api` and nothing else.
 *
 *   VITE_JARVIS_API_URL set  → your own Jarvis backend (services/jarvis)
 *   Supabase keys set        → Supabase (services/live)
 *   nothing set              → demo mode, sample data (services/demo)
 *
 * To put another backend behind the app, return a different `JarvisService` here.
 */
import { BACKEND, JARVIS_API_URL } from '@/lib/env'
import { createDemoService } from '@/services/demo'
import { createJarvisBackendService } from '@/services/jarvis'
import { createLiveService } from '@/services/live'
import type { JarvisService } from '@/services/types'

function createService(): JarvisService {
  switch (BACKEND) {
    case 'jarvis':
      return createJarvisBackendService(JARVIS_API_URL)
    case 'supabase':
      return createLiveService()
    case 'demo':
      return createDemoService()
  }
}

export const api: JarvisService = createService()

export type { AuthApi, AuthUser, JarvisService } from '@/services/types'
export { ServiceError, errorMessage, isNotFound, isServiceError } from '@/services/errors'
