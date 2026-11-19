import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { VoiceContext } from '@/features/voice/context'
import { VOICE_MESSAGE } from '@/features/voice/messages'
import { TalkPanel } from '@/features/voice/TalkPanel'
import { fakeController, transcriptOf } from '@/features/voice/testing'
import type { EngineState, VoiceContextValue, VoiceController } from '@/features/voice/types'

function renderPanel(
  controller: VoiceController = fakeController(),
  options: { engine?: EngineState; needsNetwork?: boolean; reloadEngine?: () => void } = {},
) {
  const value: VoiceContextValue = {
    controller,
    engine: options.engine ?? 'ready',
    reloadEngine: options.reloadEngine ?? vi.fn(),
    needsNetwork: options.needsNetwork ?? false,
  }
  const view = render(
    <VoiceContext.Provider value={value}>
      <TalkPanel />
    </VoiceContext.Provider>,
  )
  return { ...view, controller }
}

const talkButton = () => screen.getByRole('button', { name: 'Talk to Jarvis' })

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online })
}

afterEach(() => setOnline(true))

describe('TalkPanel', () => {
  it.each([
    ['idle', fakeController(), 'Talk to Jarvis'],
    ['connecting', fakeController({ status: 'connecting', channel: 'voice' }), 'Connecting…'],
    ['listening', fakeController({ status: 'live', channel: 'voice' }), 'Listening'],
    ['speaking', fakeController({ status: 'live', channel: 'voice', mode: 'speaking' }), 'Jarvis is speaking'],
    ['muted', fakeController({ status: 'live', channel: 'voice', muted: true }), 'You’re muted'],
    ['chatting', fakeController({ status: 'live', channel: 'text' }), 'Chatting with Jarvis'],
  ])('says what is happening when %s', (_name, controller, line) => {
    renderPanel(controller)
    expect(talkButton()).toHaveAccessibleDescription(line)
  })

  it('reads "Getting ready…" and cannot be pressed until the engine has loaded', () => {
    renderPanel(fakeController(), { engine: 'loading', needsNetwork: true })
    expect(talkButton()).toBeDisabled()
    expect(talkButton()).toHaveAccessibleDescription('Getting ready…')
  })

  it('offers a retry when the engine could not be loaded', async () => {
    const reloadEngine = vi.fn()
    renderPanel(fakeController(), { engine: 'failed', reloadEngine })
    expect(screen.getByRole('alert')).toHaveTextContent(VOICE_MESSAGE.engineFailed)
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(reloadEngine).toHaveBeenCalledOnce()
  })

  it('is disabled while offline when voice needs the network', () => {
    setOnline(false)
    renderPanel(fakeController(), { needsNetwork: true })
    expect(talkButton()).toBeDisabled()
    expect(talkButton()).toHaveAccessibleDescription(VOICE_MESSAGE.offline)
  })

  it('starts a spoken conversation, and ends it when pressed again', async () => {
    const { controller, rerender } = renderPanel()
    expect(talkButton()).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(talkButton())
    expect(controller.startVoice).toHaveBeenCalledOnce()

    const live = fakeController({ status: 'live', channel: 'voice' })
    rerender(
      <VoiceContext.Provider value={{ controller: live, engine: 'ready', reloadEngine: vi.fn(), needsNetwork: false }}>
        <TalkPanel />
      </VoiceContext.Provider>,
    )
    expect(talkButton()).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(talkButton())
    expect(live.stop).toHaveBeenCalledOnce()
  })

  it('ends a conversation that is still connecting', async () => {
    const { controller } = renderPanel(fakeController({ status: 'connecting', channel: 'voice' }))
    await userEvent.click(talkButton())
    expect(controller.stop).toHaveBeenCalledOnce()
  })

  it('moves a typed conversation to voice when Talk is pressed', async () => {
    const { controller } = renderPanel(fakeController({ status: 'live', channel: 'text' }))
    expect(talkButton()).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(talkButton())
    expect(controller.startVoice).toHaveBeenCalledOnce()
  })

  it('mutes, unmutes and ends a live spoken conversation', async () => {
    const { controller, rerender } = renderPanel(fakeController({ status: 'live', channel: 'voice' }))
    const mute = screen.getByRole('button', { name: 'Mute' })
    expect(mute).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(mute)
    expect(controller.setMuted).toHaveBeenCalledWith(true)
    await userEvent.click(screen.getByRole('button', { name: 'End' }))
    expect(controller.stop).toHaveBeenCalledOnce()

    const muted = fakeController({ status: 'live', channel: 'voice', muted: true })
    rerender(
      <VoiceContext.Provider value={{ controller: muted, engine: 'ready', reloadEngine: vi.fn(), needsNetwork: false }}>
        <TalkPanel />
      </VoiceContext.Provider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Unmute' }))
    expect(muted.setMuted).toHaveBeenCalledWith(false)
  })

  it('offers no mute in a typed conversation', () => {
    renderPanel(fakeController({ status: 'live', channel: 'text' }))
    expect(screen.queryByRole('button', { name: 'Mute' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'End' })).toBeInTheDocument()
  })

  it('shows an error with a retry and keeps the transcript', async () => {
    const { controller } = renderPanel(
      fakeController({
        status: 'error',
        error: VOICE_MESSAGE.micBlocked,
        transcript: transcriptOf(['jarvis', 'Good evening.']),
      }),
    )
    expect(screen.getByRole('alert')).toHaveTextContent(VOICE_MESSAGE.micBlocked)
    expect(screen.getByRole('log')).toHaveTextContent('Good evening.')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(controller.retry).toHaveBeenCalledOnce()
  })

  it('opens the composer on "Type instead" and sends with Enter, keeping focus', async () => {
    const { controller } = renderPanel()
    expect(screen.queryByRole('textbox', { name: 'Message Jarvis' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Type instead' }))

    const field = screen.getByRole('textbox', { name: 'Message Jarvis' })
    const send = screen.getByRole('button', { name: 'Send' })
    expect(field).toHaveFocus()
    expect(send).toBeDisabled()

    await userEvent.type(field, '  Any missed calls?  {Enter}')
    expect(controller.sendText).toHaveBeenCalledWith('Any missed calls?')
    expect(field).toHaveValue('')
    expect(field).toHaveFocus()

    await userEvent.type(field, 'And bookings?')
    await userEvent.click(send)
    expect(controller.sendText).toHaveBeenLastCalledWith('And bookings?')
    expect(field).toHaveFocus()
  })

  it('keeps sending disabled while a conversation is connecting', async () => {
    renderPanel(fakeController({ status: 'connecting', channel: 'text' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Message Jarvis' }), 'Hello')
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  })

  it('shows the transcript with each speaker named, and a quiet "…" while Jarvis works out an answer', () => {
    renderPanel(
      fakeController({
        status: 'live',
        channel: 'text',
        transcript: transcriptOf(['jarvis', 'Here’s where today stands.'], ['you', 'Any missed calls?']),
      }),
    )
    const log = screen.getByRole('log', { name: 'Conversation with Jarvis' })
    const lines = within(log).getAllByRole('listitem')
    expect(lines.map((line) => line.textContent)).toEqual([
      'Jarvis: Here’s where today stands.',
      'You: Any missed calls?',
    ])
    expect(log).toHaveTextContent('…')
    // The composer stays while a conversation is going.
    expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).toBeInTheDocument()
  })

  it('offers "Clear" only once the conversation is over', async () => {
    const transcript = transcriptOf(['jarvis', 'That’s the brief.'])
    const { rerender } = renderPanel(fakeController({ status: 'live', channel: 'voice', transcript }))
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument()

    const idle = fakeController({ transcript })
    rerender(
      <VoiceContext.Provider value={{ controller: idle, engine: 'ready', reloadEngine: vi.fn(), needsNetwork: false }}>
        <TalkPanel />
      </VoiceContext.Provider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(idle.clear).toHaveBeenCalledOnce()
  })
})
