import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useVoice } from '@/features/voice/context'
import { fakeController, sampleSource } from '@/features/voice/testing'
import type { EngineProps } from '@/features/voice/types'
import { LiveVoiceProvider, VoiceProvider } from '@/features/voice/VoiceProvider'

const loaded = vi.hoisted(() => ({ sdk: false, engine: false }))

vi.mock('@elevenlabs/react', () => {
  loaded.sdk = true
  return {}
})
vi.mock('@/features/voice/elevenlabs/ElevenLabsEngine', () => {
  loaded.engine = true
  return { default: () => null }
})

const source = vi.hoisted(() => ({ current: null as ReturnType<typeof sampleSource> | null }))
vi.mock('@/services', async () => {
  const errors = await vi.importActual<typeof import('@/services/errors')>('@/services/errors')
  const api = {
    mode: 'demo',
    getBrief: () => source.current!.getBrief(),
    listApprovals: () => source.current!.listApprovals(),
    listTasks: () => source.current!.listTasks(),
    listShops: () => source.current!.listShops(),
  }
  return { ...errors, api }
})

vi.mock('@/app/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'owner-1' } }) }))

const updates = vi.hoisted(() => ({ held: 0, release: vi.fn() }))
vi.mock('@/lib/updates', () => ({
  holdUpdates: () => {
    updates.held += 1
    return () => {
      updates.held -= 1
      updates.release()
    }
  },
}))

/** Shows what the Talk UI would read, and counts its own mounts. */
function Probe({ onMount }: { onMount?: () => void }) {
  const { controller, engine, reloadEngine } = useVoice()
  const mounted = useRef(onMount)
  useEffect(() => mounted.current?.(), [])
  return (
    <div>
      <p>engine {engine}</p>
      <p>status {controller.status}</p>
      <button type="button" onClick={controller.startVoice}>
        start
      </button>
      <button type="button" onClick={controller.stop}>
        stop
      </button>
      <button type="button" onClick={reloadEngine}>
        reload
      </button>
    </div>
  )
}

beforeEach(() => {
  source.current = sampleSource()
  updates.held = 0
  updates.release.mockClear()
})

describe('VoiceProvider in demo mode', () => {
  it('is ready at once and never loads the ElevenLabs SDK', async () => {
    render(
      <VoiceProvider>
        <Probe />
      </VoiceProvider>,
    )
    expect(screen.getByText('engine ready')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'start' }))
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
    expect(loaded.sdk).toBe(false)
    expect(loaded.engine).toBe(false)
  })

  it('holds app updates while a conversation is connecting or live', async () => {
    render(
      <VoiceProvider>
        <Probe />
      </VoiceProvider>,
    )
    expect(updates.held).toBe(0)
    await userEvent.click(screen.getByRole('button', { name: 'start' }))
    expect(screen.getByText('status connecting')).toBeInTheDocument()
    expect(updates.held).toBe(1)
    await waitFor(() => expect(screen.getByText('status live')).toBeInTheDocument())
    expect(updates.held).toBe(1)
    await userEvent.click(screen.getByRole('button', { name: 'stop' }))
    expect(updates.held).toBe(0)
    expect(updates.release).toHaveBeenCalledOnce()
  })
})

describe('LiveVoiceProvider', () => {
  it('reads "loading" until the engine arrives, without remounting the app', async () => {
    let finish: (engine: { default: (props: EngineProps) => null }) => void = () => {}
    const load = vi.fn(() => new Promise<{ default: (props: EngineProps) => null }>((resolve) => (finish = resolve)))
    const onMount = vi.fn()
    render(
      <LiveVoiceProvider load={load}>
        <Probe onMount={onMount} />
      </LiveVoiceProvider>,
    )
    expect(screen.getByText('engine loading')).toBeInTheDocument()
    await waitFor(() => expect(load).toHaveBeenCalledOnce())

    const seenUser = vi.fn()
    function Engine({ userId, onController }: EngineProps) {
      useEffect(() => {
        seenUser(userId)
        onController(fakeController())
      }, [userId, onController])
      return null
    }
    await act(async () => finish({ default: Engine }))
    expect(screen.getByText('engine ready')).toBeInTheDocument()
    expect(seenUser).toHaveBeenCalledWith('owner-1')
    expect(onMount).toHaveBeenCalledOnce()
  })

  it('reports a failed load and tries again when asked', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('chunk failed')).mockReturnValue(new Promise(() => {}))
    render(
      <LiveVoiceProvider load={load}>
        <Probe />
      </LiveVoiceProvider>,
    )
    await waitFor(() => expect(screen.getByText('engine failed')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'reload' }))
    expect(screen.getByText('engine loading')).toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(2)
  })
})
