import { beforeEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({ SUPABASE_URL: '', SUPABASE_KEY: '', IS_DEMO: false }))

// Getters, so each test can change the environment before it loads the module.
vi.mock('@/lib/env', () => ({
  get SUPABASE_URL() {
    return env.SUPABASE_URL
  },
  get SUPABASE_KEY() {
    return env.SUPABASE_KEY
  },
  IS_DEMO: false,
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }))

/** A fresh copy of the module (it keeps one client for the life of the page) and of the mocked factory. */
async function load() {
  vi.resetModules()
  const { createClient } = await import('@supabase/supabase-js')
  const { getClient } = await import('./client')
  return { getClient, createClient: vi.mocked(createClient) }
}

function failureOf(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  throw new Error('Expected it to throw.')
}

describe('the Supabase client', () => {
  beforeEach(() => {
    env.SUPABASE_URL = 'https://jarvis-test.supabase.co'
    env.SUPABASE_KEY = 'sb_publishable_test'
  })

  it('is built once, for the project in the environment', async () => {
    const { getClient, createClient } = await load()
    const made = { name: 'the client' }
    createClient.mockReturnValue(made as never)

    expect(getClient()).toBe(made)
    expect(getClient()).toBe(made)

    expect(createClient).toHaveBeenCalledTimes(1)
    expect(createClient).toHaveBeenCalledWith('https://jarvis-test.supabase.co', 'sb_publishable_test', expect.anything())
  })

  it('keeps the owner signed in between launches and picks up a sign-in link', async () => {
    const { getClient, createClient } = await load()
    createClient.mockReturnValue({} as never)

    getClient()

    const options = createClient.mock.calls[0][2]
    expect(options?.auth).toMatchObject({ persistSession: true, autoRefreshToken: true, detectSessionInUrl: true })
  })

  it('leaves retries to the app and gives up on a request that hangs', async () => {
    const { getClient, createClient } = await load()
    createClient.mockReturnValue({} as never)

    getClient()

    const options = createClient.mock.calls[0][2]
    expect(options?.db?.retry).toBe(false)
    expect(options?.db?.timeout).toBeGreaterThan(0)
  })

  it('says how to fix a project URL that is not a URL', async () => {
    env.SUPABASE_URL = 'jarvis-test.supabase.co'
    const { getClient, createClient } = await load()
    // The real factory is what rejects a malformed URL.
    const actual = await vi.importActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js')
    createClient.mockImplementation(actual.createClient)

    expect(failureOf(getClient)).toMatchObject({
      name: 'ServiceError',
      code: 'not_configured',
      message: 'The Supabase URL in .env isn’t valid. It should look like https://your-project.supabase.co.',
    })
  })

  it('never builds a client without keys', async () => {
    env.SUPABASE_KEY = ''
    const { getClient, createClient } = await load()

    expect(failureOf(getClient)).toMatchObject({ name: 'ServiceError', code: 'not_configured' })
    expect(createClient).not.toHaveBeenCalled()
  })
})
