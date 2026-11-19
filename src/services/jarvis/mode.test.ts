/** Which backend the app picks from its build settings (lib/env.ts, services/index.ts). */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { chooseBackend } from '@/lib/env'

const NOTHING = {
  VITE_JARVIS_API_URL: '',
  VITE_SUPABASE_URL: '',
  VITE_SUPABASE_PUBLISHABLE_KEY: '',
  VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY: '',
  VITE_SUPABASE_ANON_KEY: '',
}

async function loadWith(env: Partial<typeof NOTHING>) {
  for (const [name, value] of Object.entries({ ...NOTHING, ...env })) vi.stubEnv(name, value)
  vi.resetModules()
  const settings = await import('@/lib/env')
  const { api } = await import('@/services')
  return { settings, api }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('choosing the backend', () => {
  it('prefers the Jarvis backend, then Supabase, then demo', () => {
    const none = { jarvisUrl: '', supabaseUrl: '', supabaseKey: '' }
    expect(chooseBackend(none)).toBe('demo')
    expect(chooseBackend({ ...none, supabaseUrl: 'https://x.supabase.co' })).toBe('demo')
    expect(chooseBackend({ ...none, supabaseKey: 'sb_publishable_x' })).toBe('demo')
    expect(chooseBackend({ ...none, supabaseUrl: 'https://x.supabase.co', supabaseKey: 'k' })).toBe('supabase')
    expect(chooseBackend({ jarvisUrl: 'https://jarvis.example.com', supabaseUrl: 'https://x.supabase.co', supabaseKey: 'k' })).toBe('jarvis')
    expect(chooseBackend({ ...none, jarvisUrl: '   ' })).toBe('demo')
  })

  it('runs the demo only when nothing is set', async () => {
    const { settings, api } = await loadWith({})
    expect(settings.BACKEND).toBe('demo')
    expect(settings.IS_DEMO).toBe(true)
    expect(api.mode).toBe('demo')
  })

  it('talks to the Jarvis backend when its address is set', async () => {
    const { settings, api } = await loadWith({
      VITE_JARVIS_API_URL: ' https://jarvis.example.com/ ',
      VITE_SUPABASE_URL: 'https://x.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
    })
    expect(settings.BACKEND).toBe('jarvis')
    expect(settings.JARVIS_API_URL).toBe('https://jarvis.example.com')
    expect(settings.IS_DEMO).toBe(false)
    expect(api.mode).toBe('live')
  })

  it('falls back to Supabase when only its keys are set', async () => {
    const { settings, api } = await loadWith({
      VITE_SUPABASE_URL: 'https://x.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon',
    })
    expect(settings.BACKEND).toBe('supabase')
    expect(api.mode).toBe('live')
  })
})
