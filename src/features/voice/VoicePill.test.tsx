import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { routes } from '@/lib/links'
import { VoiceContext } from '@/features/voice/context'
import { fakeController } from '@/features/voice/testing'
import type { VoiceController } from '@/features/voice/types'
import { VoicePill } from '@/features/voice/VoicePill'

function renderPill(controller: VoiceController, path: string) {
  render(
    <VoiceContext.Provider value={{ controller, engine: 'ready', reloadEngine: vi.fn(), needsNetwork: false }}>
      <MemoryRouter initialEntries={[path]}>
        <VoicePill />
        <Routes>
          <Route path={routes.home} element={<h1>Home</h1>} />
          <Route path="*" element={<h1>Elsewhere</h1>} />
        </Routes>
      </MemoryRouter>
    </VoiceContext.Provider>,
  )
  return controller
}

describe('VoicePill', () => {
  it('stays hidden on Home', () => {
    renderPill(fakeController({ status: 'live', channel: 'voice' }), routes.home)
    expect(screen.queryByRole('group', { name: 'Conversation with Jarvis' })).not.toBeInTheDocument()
  })

  it.each([
    ['idle', fakeController()],
    ['connecting', fakeController({ status: 'connecting', channel: 'voice' })],
    ['after an error', fakeController({ status: 'error', error: 'The connection to Jarvis dropped.' })],
  ])('stays hidden when %s', (_name, controller) => {
    renderPill(controller, '/calls')
    expect(screen.queryByRole('group', { name: 'Conversation with Jarvis' })).not.toBeInTheDocument()
  })

  it.each([
    [fakeController({ status: 'live', channel: 'voice' }), 'Jarvis is listening'],
    [fakeController({ status: 'live', channel: 'voice', mode: 'speaking' }), 'Jarvis is speaking'],
    [fakeController({ status: 'live', channel: 'text' }), 'Chatting with Jarvis'],
  ])('says "%s" away from Home while live', (controller, label) => {
    renderPill(controller, '/calls')
    expect(screen.getByRole('link', { name: label })).toBeInTheDocument()
  })

  it('goes Home when pressed', async () => {
    renderPill(fakeController({ status: 'live', channel: 'voice' }), '/calls')
    await userEvent.click(screen.getByRole('link', { name: 'Jarvis is listening' }))
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Jarvis is listening' })).not.toBeInTheDocument()
  })

  it('ends the conversation from the End button', async () => {
    const controller = renderPill(fakeController({ status: 'live', channel: 'text' }), '/code')
    await userEvent.click(screen.getByRole('button', { name: 'End' }))
    expect(controller.stop).toHaveBeenCalledOnce()
  })
})
