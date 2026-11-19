import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ConnectionStatus, Settings, SettingsPatch } from '@/lib/types'
import { ToastProvider } from '@/components/ui/Toast'
import SettingsScreen from '@/features/settings'

const service = vi.hoisted(() => ({
  mode: 'demo' as 'demo' | 'live',
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  getConnections: vi.fn(),
  auth: { signOut: vi.fn() },
}))

vi.mock('@/services', async () => {
  const errors = await vi.importActual<typeof import('@/services/errors')>('@/services/errors')
  return { ...errors, api: service }
})

const install = vi.hoisted(() => ({
  state: { canPrompt: false, standalone: false, ios: false, prompt: vi.fn() },
}))

vi.mock('@/lib/install', () => ({ useInstall: () => install.state }))

vi.mock('@/app/AuthProvider', () => ({
  useAuth: () => ({ status: 'signed_in', user: { id: 'owner-1', email: 'owner@example.com' } }),
}))

const SETTINGS: Settings = {
  id: 'settings-1',
  owner_id: 'owner-1',
  notify_phone: '+15125550142',
  notification_prefs: {
    missed_call: 'text',
    failed_call: 'text',
    approval_needed: 'call',
    task_done: 'in_app',
    task_failed: 'text',
    system: 'in_app',
  },
  quiet_hours_enabled: true,
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:00',
  timezone: 'America/Chicago',
  allowed_repos: ['acme/booking-site', 'acme/shop-tools'],
  updated_at: '2026-11-18T12:00:00.000Z',
}

function connections(checkedAt = new Date().toISOString()): ConnectionStatus[] {
  return [
    { service: 'elevenlabs', state: 'connected', detail: 'The voice agent answered.', latency_ms: 180, checked_at: checkedAt },
    { service: 'twilio', state: 'connected', detail: 'Two shop numbers are attached.', latency_ms: 240, checked_at: checkedAt },
    { service: 'notion', state: 'not_configured', detail: 'Add a Notion key to sync the handbook.', latency_ms: null, checked_at: checkedAt },
    { service: 'jarvis', state: 'error', detail: 'The backend did not answer in time.', latency_ms: null, checked_at: checkedAt },
  ]
}

/** What the pretend backend currently holds. */
let stored: Settings

function renderSettings() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ToastProvider>
          <SettingsScreen />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** A promise the test settles by hand, to look at the moment in between. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  stored = { ...SETTINGS }
  service.mode = 'demo'
  service.getSettings.mockReset().mockImplementation(async () => stored)
  service.updateSettings.mockReset().mockImplementation(async (patch: SettingsPatch) => {
    stored = { ...stored, ...patch }
    return stored
  })
  service.getConnections.mockReset().mockImplementation(async () => connections())
  service.auth.signOut.mockReset().mockResolvedValue(undefined)
  install.state = { canPrompt: false, standalone: false, ios: false, prompt: vi.fn() }
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Connections', () => {
  it('shows each service with what it is for, its state and the detail', async () => {
    renderSettings()

    const rows = await screen.findAllByRole('listitem')
    const elevenlabs = rows.find((row) => within(row).queryByText('ElevenLabs'))
    const notion = rows.find((row) => within(row).queryByText('Notion'))
    const jarvis = rows.find((row) => within(row).queryByText('Jarvis backend'))
    if (!elevenlabs || !notion || !jarvis) throw new Error('A connection row is missing.')

    expect(within(elevenlabs).getByText('Jarvis’s voice')).toBeInTheDocument()
    expect(within(elevenlabs).getByText('Connected')).toBeInTheDocument()
    expect(within(elevenlabs).getByText('The voice agent answered.')).toBeInTheDocument()
    expect(within(notion).getByText('Not set up')).toBeInTheDocument()
    expect(within(jarvis).getByText('Not working')).toBeInTheDocument()
    expect(within(jarvis).getByText('The backend did not answer in time.')).toBeInTheDocument()
    expect(screen.getByText('Checked just now')).toBeInTheDocument()
  })

  it('checks again when asked, and says so while it does', async () => {
    const user = userEvent.setup()
    renderSettings()
    await screen.findByText('ElevenLabs')

    const recheck = deferred<ConnectionStatus[]>()
    service.getConnections.mockImplementation(() => recheck.promise)
    await user.click(screen.getByRole('button', { name: 'Check again' }))

    expect(service.getConnections).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled()

    recheck.resolve(connections().map((item) => ({ ...item, state: 'connected', detail: 'All good.' })))
    expect(await screen.findByRole('button', { name: 'Check again' })).toBeEnabled()
    expect(screen.queryByText('Not working')).not.toBeInTheDocument()
  })

  it('says when the check itself failed and lets the owner retry', async () => {
    const user = userEvent.setup()
    service.getConnections.mockRejectedValueOnce(new Error('You are offline.'))
    renderSettings()

    expect(await screen.findByText('Couldn’t check your connections.')).toBeInTheDocument()
    expect(screen.getByText('You are offline.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('ElevenLabs')).toBeInTheDocument()
  })

  it('keeps the last result on screen when a later check fails', async () => {
    const user = userEvent.setup()
    renderSettings()
    await screen.findByText('ElevenLabs')

    service.getConnections.mockRejectedValueOnce(new Error('You are offline.'))
    await user.click(screen.getByRole('button', { name: 'Check again' }))

    expect(await screen.findByText('Couldn’t check again. You are offline.')).toBeInTheDocument()
    expect(screen.getByText('ElevenLabs')).toBeInTheDocument()
  })
})

describe('Notifications', () => {
  function channel(alert: string, name: string) {
    return within(screen.getByRole('radiogroup', { name: alert })).getByRole('radio', { name })
  }

  it('offers the three channels for every kind of alert', async () => {
    renderSettings()
    await screen.findByRole('radiogroup', { name: 'Missed calls' })

    for (const alert of ['Missed calls', 'Failed calls', 'Approvals', 'Finished tasks', 'Failed tasks', 'System problems']) {
      const names = within(screen.getByRole('radiogroup', { name: alert }))
        .getAllByRole('radio')
        .map((radio) => radio.textContent)
      expect(names).toEqual(['Call me', 'Text me', 'In-app only'])
    }
    expect(channel('Missed calls', 'Text me')).toBeChecked()
    expect(channel('Approvals', 'Call me')).toBeChecked()
  })

  it('saves a channel change straight away, sending only the notification preferences', async () => {
    const user = userEvent.setup()
    renderSettings()
    await screen.findByRole('radiogroup', { name: 'Missed calls' })

    await user.click(channel('Missed calls', 'Call me'))

    expect(service.updateSettings).toHaveBeenCalledTimes(1)
    expect(service.updateSettings).toHaveBeenCalledWith({
      notification_prefs: { ...SETTINGS.notification_prefs, missed_call: 'call' },
    })
    expect(channel('Missed calls', 'Call me')).toBeChecked()
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })

  it('shows the change at once, then puts it back and says why when the save fails', async () => {
    const user = userEvent.setup()
    const saving = deferred<Settings>()
    service.updateSettings.mockImplementation(() => saving.promise)
    renderSettings()
    await screen.findByRole('radiogroup', { name: 'Missed calls' })

    await user.click(channel('Missed calls', 'Call me'))
    expect(channel('Missed calls', 'Call me')).toBeChecked()

    saving.reject(new Error('The Jarvis backend did not answer.'))

    expect(await screen.findByText('The Jarvis backend did not answer.')).toBeInTheDocument()
    expect(channel('Missed calls', 'Text me')).toBeChecked()
    expect(channel('Missed calls', 'Call me')).not.toBeChecked()
  })

  it('does not save when the chosen channel is already the one in use', async () => {
    const user = userEvent.setup()
    renderSettings()
    await screen.findByRole('radiogroup', { name: 'Missed calls' })

    await user.click(channel('Missed calls', 'Text me'))

    expect(service.updateSettings).not.toHaveBeenCalled()
  })

  it('keeps both changes when two are made before the first has saved', async () => {
    const user = userEvent.setup()
    const first = deferred<Settings>()
    service.updateSettings.mockImplementationOnce(() => first.promise)
    renderSettings()
    await screen.findByRole('radiogroup', { name: 'Missed calls' })

    await user.click(channel('Missed calls', 'Call me'))
    await user.click(channel('Finished tasks', 'Text me'))

    // One at a time: the second waits for the first, so answers can't cross.
    expect(service.updateSettings).toHaveBeenCalledTimes(1)
    expect(channel('Finished tasks', 'Text me')).toBeChecked()

    // The first answer comes back without the second change in it.
    stored = { ...SETTINGS, notification_prefs: { ...SETTINGS.notification_prefs, missed_call: 'call' } }
    first.resolve(stored)

    await waitFor(() => expect(service.updateSettings).toHaveBeenCalledTimes(2))
    expect(service.updateSettings).toHaveBeenLastCalledWith({
      notification_prefs: { ...SETTINGS.notification_prefs, missed_call: 'call', task_done: 'text' },
    })
    await waitFor(() => expect(screen.getAllByText('Saved')).toHaveLength(2))
    expect(channel('Missed calls', 'Call me')).toBeChecked()
    expect(channel('Finished tasks', 'Text me')).toBeChecked()
  })

  describe('mobile number', () => {
    it('shows the stored number the way people write it', async () => {
      renderSettings()
      expect(await screen.findByLabelText('Your mobile number')).toHaveValue('(512) 555-0142')
    })

    it('saves a new number in dialable form when the field is left', async () => {
      const user = userEvent.setup()
      renderSettings()
      const field = await screen.findByLabelText('Your mobile number')

      await user.clear(field)
      await user.type(field, '512 555 0199')
      expect(service.updateSettings).not.toHaveBeenCalled()
      await user.tab()

      expect(service.updateSettings).toHaveBeenCalledTimes(1)
      expect(service.updateSettings).toHaveBeenCalledWith({ notify_phone: '+15125550199' })
      await waitFor(() => expect(field).toHaveValue('(512) 555-0199'))
    })

    it('saves on Enter, once', async () => {
      const user = userEvent.setup()
      renderSettings()
      const field = await screen.findByLabelText('Your mobile number')

      await user.clear(field)
      await user.type(field, '+44 20 7946 0000{Enter}')
      await user.tab()

      expect(service.updateSettings).toHaveBeenCalledTimes(1)
      expect(service.updateSettings).toHaveBeenCalledWith({ notify_phone: '+442079460000' })
    })

    it('explains what is wrong with something that is not a number, and saves nothing', async () => {
      const user = userEvent.setup()
      renderSettings()
      const field = await screen.findByLabelText('Your mobile number')

      await user.clear(field)
      await user.type(field, 'call the shop')
      await user.tab()

      expect(field).toBeInvalid()
      expect(field).toHaveAccessibleDescription(/only have digits/)
      expect(field).toHaveValue('call the shop')
      expect(service.updateSettings).not.toHaveBeenCalled()
    })

    it('does not save the same number typed a different way', async () => {
      const user = userEvent.setup()
      renderSettings()
      const field = await screen.findByLabelText('Your mobile number')

      await user.clear(field)
      await user.type(field, '+1 512-555-0142')
      await user.tab()

      expect(service.updateSettings).not.toHaveBeenCalled()
      expect(field).toHaveValue('(512) 555-0142')
    })

    it('lets the number be removed, and warns that calls and texts need one', async () => {
      const user = userEvent.setup()
      renderSettings()
      const field = await screen.findByLabelText('Your mobile number')
      expect(screen.queryByText('Add your number so Jarvis can call or text you.')).not.toBeInTheDocument()

      await user.clear(field)
      await user.tab()

      expect(service.updateSettings).toHaveBeenCalledWith({ notify_phone: null })
      expect(await screen.findByText('Add your number so Jarvis can call or text you.')).toBeInTheDocument()
    })

    it('does not warn about a missing number when everything stays in the app', async () => {
      stored = {
        ...SETTINGS,
        notify_phone: null,
        notification_prefs: {
          missed_call: 'in_app',
          failed_call: 'in_app',
          approval_needed: 'in_app',
          task_done: 'in_app',
          task_failed: 'in_app',
          system: 'in_app',
        },
      }
      const user = userEvent.setup()
      renderSettings()
      await screen.findByLabelText('Your mobile number')
      expect(screen.queryByText('Add your number so Jarvis can call or text you.')).not.toBeInTheDocument()

      await user.click(channel('Missed calls', 'Text me'))
      expect(screen.getByText('Add your number so Jarvis can call or text you.')).toBeInTheDocument()
    })
  })

  describe('quiet hours', () => {
    /** Pins "now" without freezing timers, so waiting for the screen still works. */
    function setClock(iso: string) {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date(iso))
    }

    it('sums the window up in a sentence and says when it is on right now', async () => {
      setClock('2026-11-19T05:30:00.000Z') // 11:30 PM in Chicago
      renderSettings()

      expect(await screen.findByText(/^Quiet from 10:00\sPM to 7:00\sAM, Chicago time\.$/)).toBeInTheDocument()
      expect(screen.getByText('Quiet hours are on right now.')).toBeInTheDocument()
    })

    it('does not claim to be on outside the window', async () => {
      setClock('2026-11-19T18:00:00.000Z') // noon in Chicago
      renderSettings()

      expect(await screen.findByText(/^Quiet from 10:00\sPM/)).toBeInTheDocument()
      expect(screen.queryByText('Quiet hours are on right now.')).not.toBeInTheDocument()
    })

    it('turns off with the switch and hides the times', async () => {
      const user = userEvent.setup()
      renderSettings()
      const toggle = await screen.findByRole('switch', { name: 'Quiet hours' })
      expect(toggle).toBeChecked()

      await user.click(toggle)

      expect(service.updateSettings).toHaveBeenCalledWith({ quiet_hours_enabled: false })
      expect(toggle).not.toBeChecked()
      expect(screen.queryByLabelText('From')).not.toBeInTheDocument()
      expect(screen.queryByText(/^Quiet from/)).not.toBeInTheDocument()
    })

    it('saves a new time when the field is left, and rewrites the sentence', async () => {
      renderSettings()
      const from = await screen.findByLabelText('From')
      expect(from).toHaveValue('22:00')
      expect(screen.getByLabelText('Until')).toHaveValue('07:00')

      fireEvent.change(from, { target: { value: '23:30' } })
      fireEvent.blur(from)

      await waitFor(() => expect(service.updateSettings).toHaveBeenCalledWith({ quiet_hours_start: '23:30' }))
      expect(service.updateSettings).toHaveBeenCalledTimes(1)
      expect(await screen.findByText(/^Quiet from 11:30\sPM to 7:00\sAM, Chicago time\.$/)).toBeInTheDocument()
    })

    it('saves a time by itself once the picker has settled, and only the last value', async () => {
      renderSettings()
      const until = await screen.findByLabelText('Until')

      fireEvent.change(until, { target: { value: '06:00' } })
      fireEvent.change(until, { target: { value: '06:30' } })
      expect(service.updateSettings).not.toHaveBeenCalled()

      await waitFor(() => expect(service.updateSettings).toHaveBeenCalledWith({ quiet_hours_end: '06:30' }), {
        timeout: 3000,
      })
      expect(service.updateSettings).toHaveBeenCalledTimes(1)
    })

    it('does not save a time that was not changed or was left empty', async () => {
      renderSettings()
      const from = await screen.findByLabelText('From')

      fireEvent.blur(from)
      fireEvent.change(from, { target: { value: '' } })
      fireEvent.blur(from)

      expect(service.updateSettings).not.toHaveBeenCalled()
      expect(from).toHaveValue('22:00')
    })

    it('saves a different time zone', async () => {
      const user = userEvent.setup()
      renderSettings()
      const zone = await screen.findByLabelText('Time zone')
      expect(zone).toHaveValue('America/Chicago')
      expect(within(zone).getByRole('option', { name: 'Chicago (America/Chicago)' })).toBeInTheDocument()

      await user.selectOptions(zone, 'America/Denver')

      expect(service.updateSettings).toHaveBeenCalledWith({ timezone: 'America/Denver' })
      expect(await screen.findByText(/, Denver time\.$/)).toBeInTheDocument()
    })

    it('offers the phone’s own time zone when it differs from the saved one', async () => {
      const resolved = Intl.DateTimeFormat().resolvedOptions()
      vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
        ...resolved,
        timeZone: 'America/Los_Angeles',
      })
      const user = userEvent.setup()
      renderSettings()

      await user.click(
        await screen.findByRole('button', { name: 'Use this phone’s time zone (America/Los_Angeles)' }),
      )

      expect(service.updateSettings).toHaveBeenCalledWith({ timezone: 'America/Los_Angeles' })
      expect(screen.getByLabelText('Time zone')).toHaveValue('America/Los_Angeles')
      expect(screen.queryByRole('button', { name: /Use this phone’s time zone/ })).not.toBeInTheDocument()
    })
  })
})

describe('Repos Jarvis can work in', () => {
  it('adds a valid repo and clears the field', async () => {
    const user = userEvent.setup()
    renderSettings()
    const field = await screen.findByLabelText('Add a repo')
    expect(field).toHaveAttribute('placeholder', 'owner/name')

    await user.type(field, 'acme/pos-reports')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(service.updateSettings).toHaveBeenCalledWith({
      allowed_repos: ['acme/booking-site', 'acme/shop-tools', 'acme/pos-reports'],
    })
    expect(field).toHaveValue('')
    expect(screen.getByText('acme/pos-reports')).toBeInTheDocument()
    expect(await screen.findByText('Added')).toBeInTheDocument()
  })

  it('refuses something that is not owner/name', async () => {
    const user = userEvent.setup()
    renderSettings()
    const field = await screen.findByLabelText('Add a repo')

    await user.type(field, 'booking site{Enter}')

    expect(field).toBeInvalid()
    expect(field).toHaveAccessibleDescription(/doesn’t look like a repo/)
    expect(field).toHaveValue('booking site')
    expect(service.updateSettings).not.toHaveBeenCalled()
  })

  it('refuses a repo that is already listed, whatever the capitals', async () => {
    const user = userEvent.setup()
    renderSettings()
    const field = await screen.findByLabelText('Add a repo')

    await user.type(field, 'Acme/Booking-Site{Enter}')

    expect(field).toHaveAccessibleDescription('Acme/Booking-Site is already on the list.')
    expect(service.updateSettings).not.toHaveBeenCalled()
  })

  it('removes a repo only after the owner confirms', async () => {
    const user = userEvent.setup()
    renderSettings()

    await user.click(await screen.findByRole('button', { name: 'Remove acme/shop-tools' }))
    expect(service.updateSettings).not.toHaveBeenCalled()

    const dialog = screen.getByRole('dialog', { name: 'Remove this repo?' })
    expect(dialog).toHaveTextContent('Jarvis won’t start new coding tasks in acme/shop-tools.')
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))

    expect(service.updateSettings).toHaveBeenCalledWith({ allowed_repos: ['acme/booking-site'] })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('acme/shop-tools')).not.toBeInTheDocument()
    expect(await screen.findByText('Removed')).toBeInTheDocument()
  })

  it('keeps the repo when the owner backs out', async () => {
    const user = userEvent.setup()
    renderSettings()

    await user.click(await screen.findByRole('button', { name: 'Remove acme/shop-tools' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Go back' }))

    expect(service.updateSettings).not.toHaveBeenCalled()
    expect(screen.getByText('acme/shop-tools')).toBeInTheDocument()
  })

  it('puts a removed repo back when the save fails', async () => {
    const user = userEvent.setup()
    service.updateSettings.mockRejectedValue(new Error('You are offline.'))
    renderSettings()

    await user.click(await screen.findByRole('button', { name: 'Remove acme/shop-tools' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }))

    expect(await screen.findByText('You are offline.')).toBeInTheDocument()
    expect(screen.getByText('acme/shop-tools')).toBeInTheDocument()
  })

  it('invites the first repo when there are none', async () => {
    stored = { ...SETTINGS, allowed_repos: [] }
    renderSettings()

    expect(await screen.findByText('No repos yet.')).toBeInTheDocument()
    expect(screen.getByText('Add one so you can start coding tasks.')).toBeInTheDocument()
    expect(screen.getByLabelText('Add a repo')).toBeInTheDocument()
  })
})

describe('On your phone', () => {
  it('says so when Jarvis is already installed', () => {
    install.state = { ...install.state, standalone: true, canPrompt: true }
    renderSettings()

    expect(screen.getByText('Jarvis is installed on this device.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add to home screen' })).not.toBeInTheDocument()
  })

  it('offers the browser’s install prompt when there is one', async () => {
    const user = userEvent.setup()
    install.state = { ...install.state, canPrompt: true }
    renderSettings()

    await user.click(screen.getByRole('button', { name: 'Add to home screen' }))

    expect(install.state.prompt).toHaveBeenCalledTimes(1)
  })

  it('walks through the steps on an iPhone', () => {
    install.state = { ...install.state, ios: true }
    renderSettings()

    const section = screen.getByRole('heading', { name: 'On your phone' }).closest('section')
    if (!section) throw new Error('The section is missing.')
    const steps = within(section).getAllByRole('listitem').map((step) => step.textContent)
    expect(steps).toEqual(['Open this page in Safari', 'Tap Share', 'Tap Add to Home Screen'])
  })

  it('points to the browser menu everywhere else', () => {
    renderSettings()

    expect(
      screen.getByText(
        'Open this page on your phone, then choose Add to Home Screen (or Install app) from the browser menu.',
      ),
    ).toBeInTheDocument()
  })
})

describe('Account', () => {
  it('explains demo mode and offers no sign-out', () => {
    renderSettings()

    expect(
      screen.getByText(
        'Demo mode. You are looking at sample data and nothing is saved. Connect your Jarvis backend to go live.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
  })

  it('shows who is signed in and signs out after a confirm step', async () => {
    const user = userEvent.setup()
    service.mode = 'live'
    renderSettings()

    expect(screen.getByText('owner@example.com')).toBeInTheDocument()
    expect(screen.getByText(/^Signed in as/)).toBeInTheDocument()
    expect(screen.queryByText(/Demo mode/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(service.auth.signOut).not.toHaveBeenCalled()

    const dialog = screen.getByRole('dialog', { name: 'Sign out of Jarvis?' })
    await user.click(within(dialog).getByRole('button', { name: 'Sign out' }))

    expect(service.auth.signOut).toHaveBeenCalledTimes(1)
  })

  it('says why when signing out fails', async () => {
    const user = userEvent.setup()
    service.mode = 'live'
    service.auth.signOut.mockRejectedValue(new Error('You are offline.'))
    renderSettings()

    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByText('You are offline.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('Loading and failing', () => {
  it('holds the shape of the screen while settings load', async () => {
    const loading = deferred<Settings>()
    service.getSettings.mockImplementation(() => loading.promise)
    renderSettings()

    expect(screen.getByRole('status', { name: 'Loading notification settings' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Loading repos' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Checking connections' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Notifications' })).toBeInTheDocument()

    loading.resolve(SETTINGS)
    expect(await screen.findByLabelText('Your mobile number')).toBeInTheDocument()
  })

  it('says when settings could not be loaded and loads them on retry', async () => {
    const user = userEvent.setup()
    service.getSettings.mockRejectedValueOnce(new Error('You are offline.'))
    renderSettings()

    expect(await screen.findByText('Couldn’t load your settings.')).toBeInTheDocument()
    // The rest of the screen still works without them.
    expect(screen.getByRole('heading', { name: 'On your phone' })).toBeInTheDocument()
    expect(await screen.findByText('ElevenLabs')).toBeInTheDocument()

    const failure = screen.getByText('Couldn’t load your settings.').closest('[role="alert"]')
    if (!(failure instanceof HTMLElement)) throw new Error('The error state is missing.')
    await user.click(within(failure).getByRole('button', { name: 'Try again' }))

    expect(await screen.findByLabelText('Your mobile number')).toBeInTheDocument()
  })
})
