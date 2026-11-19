import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ServiceError } from '@/services/errors'
import { FakeSpeechRecognition } from '@/features/code/fakeSpeechRecognition'
import { makeTask, renderCode } from '@/features/code/testing'

const api = vi.hoisted(() => ({
  mode: 'demo',
  listAllowedRepos: vi.fn(),
  createTask: vi.fn(),
  getTask: vi.fn(),
  listTaskEvents: vi.fn(),
}))

vi.mock('@/services', async () => {
  const errors = await vi.importActual<typeof import('@/services/errors')>('@/services/errors')
  return { ...errors, api }
})

const REPOS = ['acme/booking-site', 'acme/shop-admin']

const repoSelect = () => screen.findByRole<HTMLSelectElement>('combobox', { name: 'Repo' })
const instructionsBox = () => screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'What should Jarvis do?' })
const startButton = () => screen.getByRole('button', { name: 'Start task' })

describe('Code: new task', () => {
  beforeEach(() => {
    api.listAllowedRepos.mockReset().mockResolvedValue(REPOS)
    api.createTask.mockReset()
    api.getTask.mockReset()
    api.listTaskEvents.mockReset().mockResolvedValue([])
    FakeSpeechRecognition.reset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('asks for a repo and for instructions before starting anything', async () => {
    const user = userEvent.setup()
    renderCode('/code/new')

    const select = await repoSelect()
    expect(select).toHaveValue('')
    await user.click(startButton())

    expect(screen.getByText('Choose a repo.')).toBeInTheDocument()
    expect(screen.getByText('Tell Jarvis what to do.')).toBeInTheDocument()
    expect(select).toBeInvalid()
    expect(select).toHaveFocus()
    expect(api.createTask).not.toHaveBeenCalled()
  })

  it('does not accept instructions that are only spaces', async () => {
    const user = userEvent.setup()
    renderCode('/code/new')

    await user.selectOptions(await repoSelect(), 'acme/shop-admin')
    await user.type(instructionsBox(), '   ')
    await user.click(startButton())

    expect(screen.getByText('Tell Jarvis what to do.')).toBeInTheDocument()
    expect(instructionsBox()).toHaveFocus()
    expect(api.createTask).not.toHaveBeenCalled()
  })

  it('drops a field’s error once the field is fixed', async () => {
    const user = userEvent.setup()
    renderCode('/code/new')

    await repoSelect()
    await user.click(startButton())
    await user.selectOptions(await repoSelect(), 'acme/shop-admin')
    expect(screen.queryByText('Choose a repo.')).not.toBeInTheDocument()

    await user.type(instructionsBox(), 'Add a holiday banner')
    expect(screen.queryByText('Tell Jarvis what to do.')).not.toBeInTheDocument()
  })

  it('picks the repo for you when only one is allowed', async () => {
    api.listAllowedRepos.mockResolvedValue(['acme/booking-site'])
    renderCode('/code/new')

    expect(await repoSelect()).toHaveValue('acme/booking-site')
  })

  it('points to Settings when no repos are allowed yet', async () => {
    api.listAllowedRepos.mockResolvedValue([])
    renderCode('/code/new')

    expect(await screen.findByText('No repos are allowed yet.')).toBeInTheDocument()
    expect(screen.getByText('Add one in Settings, then come back.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Settings' })).toHaveAttribute('href', '/settings')
    expect(screen.queryByRole('button', { name: 'Start task' })).not.toBeInTheDocument()
  })

  it('shows a placeholder while repos load, and a retry when they fail', async () => {
    const user = userEvent.setup()
    api.listAllowedRepos.mockRejectedValueOnce(new ServiceError('network', 'Jarvis could not be reached.'))
    renderCode('/code/new')

    expect(screen.getByRole('status', { name: 'Loading the form' })).toBeInTheDocument()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Couldn’t load your repos.')

    await user.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await repoSelect()).toBeInTheDocument()
  })

  it('starts the task and opens it in place of the form', async () => {
    const user = userEvent.setup()
    const task = makeTask({ id: 'task-9', title: 'Add a holiday banner', status: 'queued', repo: 'acme/shop-admin' })
    api.createTask.mockResolvedValue(task)
    api.getTask.mockResolvedValue(task)
    renderCode('/code/new')

    await user.selectOptions(await repoSelect(), 'acme/shop-admin')
    await user.type(instructionsBox(), '  Add a holiday banner  ')
    await user.click(startButton())

    expect(await screen.findByRole('heading', { level: 1, name: 'Add a holiday banner' })).toBeInTheDocument()
    expect(api.createTask).toHaveBeenCalledExactlyOnceWith({
      repo: 'acme/shop-admin',
      instructions: 'Add a holiday banner',
    })
    expect(screen.getByText('Task started')).toBeInTheDocument()
    // Replaced, so Back does not land on the spent form.
    expect(screen.getByTestId('location')).toHaveTextContent('/code/task-9 REPLACE')
  })

  it('shows the button as busy while the task is being started', async () => {
    const user = userEvent.setup()
    api.createTask.mockReturnValue(new Promise(() => {}))
    renderCode('/code/new')

    await user.selectOptions(await repoSelect(), 'acme/shop-admin')
    await user.type(instructionsBox(), 'Add a holiday banner')
    await user.click(startButton())

    await waitFor(() => expect(startButton()).toBeDisabled())
    expect(startButton()).toHaveAttribute('aria-busy', 'true')
  })

  it('says why the task could not start and keeps what was typed', async () => {
    const user = userEvent.setup()
    api.createTask.mockRejectedValue(new ServiceError('network', 'The Jarvis backend did not answer.'))
    renderCode('/code/new')

    await user.selectOptions(await repoSelect(), 'acme/shop-admin')
    await user.type(instructionsBox(), 'Add a holiday banner')
    await user.click(startButton())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Couldn’t start the task. The Jarvis backend did not answer.')
    expect(instructionsBox()).toHaveValue('Add a holiday banner')
    expect(await repoSelect()).toHaveValue('acme/shop-admin')
    expect(startButton()).toBeEnabled()
    expect(screen.getByTestId('location')).toHaveTextContent('/code/new')
  })

  it('counts characters only when the limit is close', async () => {
    renderCode('/code/new')
    await repoSelect()

    fireEvent.change(instructionsBox(), { target: { value: 'a'.repeat(7000) } })
    expect(screen.queryByText(/of 8.?000/)).not.toBeInTheDocument()

    fireEvent.change(instructionsBox(), { target: { value: 'a'.repeat(7001) } })
    expect(screen.getByText(/7.?001 of 8.?000/)).toBeInTheDocument()
    expect(instructionsBox()).toHaveAttribute('maxlength', '8000')
  })

  describe('dictation', () => {
    it('suggests the keyboard microphone where the browser cannot dictate', async () => {
      renderCode('/code/new')
      await repoSelect()

      expect(screen.queryByRole('button', { name: 'Dictate' })).not.toBeInTheDocument()
      expect(screen.getByText('Tip: use the microphone key on your keyboard to dictate.')).toBeInTheDocument()
    })

    it('writes what it hears at the end of the instructions', async () => {
      vi.stubGlobal('SpeechRecognition', FakeSpeechRecognition)
      const user = userEvent.setup()
      renderCode('/code/new')
      await repoSelect()
      expect(screen.queryByText(/microphone key/)).not.toBeInTheDocument()

      await user.type(instructionsBox(), 'In the booking flow,')
      await user.click(screen.getByRole('button', { name: 'Dictate' }))

      const stop = screen.getByRole('button', { name: 'Stop' })
      expect(stop).toHaveAttribute('aria-pressed', 'true')
      const recognizer = FakeSpeechRecognition.current

      act(() => recognizer.hear([{ text: 'fix the double' }]))
      expect(instructionsBox()).toHaveValue('In the booking flow, fix the double')

      act(() => recognizer.hear([{ text: 'fix the double booking.', final: true }]))
      expect(instructionsBox()).toHaveValue('In the booking flow, fix the double booking.')

      await user.click(stop)
      expect(screen.getByRole('button', { name: 'Dictate' })).toHaveAttribute('aria-pressed', 'false')
      expect(instructionsBox()).toHaveValue('In the booking flow, fix the double booking.')
    })

    it('stops listening once you type, without writing the phrase twice', async () => {
      vi.stubGlobal('SpeechRecognition', FakeSpeechRecognition)
      const user = userEvent.setup()
      renderCode('/code/new')
      await repoSelect()

      await user.click(screen.getByRole('button', { name: 'Dictate' }))
      const recognizer = FakeSpeechRecognition.current
      act(() => recognizer.hear([{ text: 'add a banner' }]))
      await user.type(instructionsBox(), '!')

      expect(recognizer.aborted).toBe(true)
      expect(screen.getByRole('button', { name: 'Dictate' })).toBeInTheDocument()
      expect(instructionsBox()).toHaveValue('add a banner!')
    })

    it('sends a phrase that is still being spoken when the task is started', async () => {
      vi.stubGlobal('SpeechRecognition', FakeSpeechRecognition)
      const user = userEvent.setup()
      api.createTask.mockReturnValue(new Promise(() => {}))
      renderCode('/code/new')

      await user.selectOptions(await repoSelect(), 'acme/shop-admin')
      await user.click(screen.getByRole('button', { name: 'Dictate' }))
      act(() => FakeSpeechRecognition.current.hear([{ text: 'add a holiday banner' }]))
      await user.click(startButton())

      expect(api.createTask).toHaveBeenCalledExactlyOnceWith({
        repo: 'acme/shop-admin',
        instructions: 'add a holiday banner',
      })
    })

    it('explains a blocked microphone and leaves the text alone', async () => {
      vi.stubGlobal('SpeechRecognition', FakeSpeechRecognition)
      const user = userEvent.setup()
      renderCode('/code/new')
      await repoSelect()

      await user.type(instructionsBox(), 'Add a banner')
      await user.click(screen.getByRole('button', { name: 'Dictate' }))
      act(() => {
        FakeSpeechRecognition.current.fail('not-allowed')
        FakeSpeechRecognition.current.end()
      })

      expect(screen.getByRole('alert')).toHaveTextContent(
        'Microphone access was blocked. Allow it in your browser settings, or type instead.',
      )
      expect(screen.getByRole('button', { name: 'Dictate' })).toBeInTheDocument()
      expect(instructionsBox()).toHaveValue('Add a banner')
    })
  })
})
