import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ToastProvider } from '@/components/ui/Toast'
import { ServiceError } from '@/services/errors'
import SignIn from '@/features/auth'

const auth = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  sendEmailCode: vi.fn(),
  verifyEmailCode: vi.fn(),
}))

vi.mock('@/services', async () => {
  const errors = await vi.importActual<typeof import('@/services/errors')>('@/services/errors')
  return { ...errors, api: { mode: 'live', auth } }
})

const EMAIL = 'owner@example.com'

function renderSignIn() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <SignIn />
      </ToastProvider>
    </MemoryRouter>,
  )
}

/** Gets to the "enter your code" step with a code already sent. */
async function sendCode(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Email me a sign-in code instead' }))
  await user.type(screen.getByLabelText('Email'), EMAIL)
  await user.click(screen.getByRole('button', { name: 'Send code' }))
  return screen.findByLabelText('Code')
}

beforeEach(() => {
  auth.signInWithPassword.mockReset().mockResolvedValue(undefined)
  auth.sendEmailCode.mockReset().mockResolvedValue(undefined)
  auth.verifyEmailCode.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Sign in', () => {
  it('is a private door: no sign-up, no way around the password', () => {
    renderSignIn()

    expect(screen.getByRole('heading', { name: 'Jarvis' })).toBeInTheDocument()
    expect(screen.getByText('Sign in to your command center.')).toBeInTheDocument()
    expect(screen.getByText('This is a private app. There is no sign-up.')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByText(/forgot/i)).not.toBeInTheDocument()
  })

  describe('with a password', () => {
    it('signs in with the email and password typed', async () => {
      const user = userEvent.setup()
      renderSignIn()

      await user.type(screen.getByLabelText('Email'), `  ${EMAIL} `)
      await user.type(screen.getByLabelText('Password'), 'correct horse')
      await user.click(screen.getByRole('button', { name: 'Sign in' }))

      expect(auth.signInWithPassword).toHaveBeenCalledTimes(1)
      expect(auth.signInWithPassword).toHaveBeenCalledWith(EMAIL, 'correct horse')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('signs in when Enter is pressed in the password field', async () => {
      const user = userEvent.setup()
      renderSignIn()

      await user.type(screen.getByLabelText('Email'), EMAIL)
      await user.type(screen.getByLabelText('Password'), 'correct horse{Enter}')

      expect(auth.signInWithPassword).toHaveBeenCalledWith(EMAIL, 'correct horse')
    })

    it('says why it failed and keeps what was typed', async () => {
      const user = userEvent.setup()
      auth.signInWithPassword.mockRejectedValue(new ServiceError('unauthorized', 'That email or password is not right.'))
      renderSignIn()

      await user.type(screen.getByLabelText('Email'), EMAIL)
      await user.type(screen.getByLabelText('Password'), 'wrong horse')
      await user.click(screen.getByRole('button', { name: 'Sign in' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('That email or password is not right.')
      expect(screen.getByLabelText('Email')).toHaveValue(EMAIL)
      expect(screen.getByLabelText('Password')).toHaveValue('wrong horse')
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
    })

    it('blocks a second press while signing in', async () => {
      const user = userEvent.setup()
      auth.signInWithPassword.mockReturnValue(new Promise(() => {}))
      renderSignIn()

      await user.type(screen.getByLabelText('Email'), EMAIL)
      await user.type(screen.getByLabelText('Password'), 'correct horse')
      await user.click(screen.getByRole('button', { name: 'Sign in' }))

      expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled()
    })

    it('asks for what is missing before calling anything', async () => {
      const user = userEvent.setup()
      renderSignIn()

      await user.click(screen.getByRole('button', { name: 'Sign in' }))

      expect(screen.getByLabelText('Email')).toHaveAccessibleDescription('Enter your email.')
      expect(screen.getByLabelText('Password')).toHaveAccessibleDescription('Enter your password.')
      expect(screen.getByLabelText('Email')).toHaveFocus()
      expect(auth.signInWithPassword).not.toHaveBeenCalled()
    })

    it('catches an email that is not an email', async () => {
      const user = userEvent.setup()
      renderSignIn()

      await user.type(screen.getByLabelText('Email'), 'owner at example')
      await user.type(screen.getByLabelText('Password'), 'correct horse')
      await user.click(screen.getByRole('button', { name: 'Sign in' }))

      expect(screen.getByLabelText('Email')).toBeInvalid()
      expect(screen.getByLabelText('Email')).toHaveAccessibleDescription('That doesn’t look like an email address.')
      expect(screen.getByLabelText('Email')).toHaveValue('owner at example')
      expect(auth.signInWithPassword).not.toHaveBeenCalled()
    })
  })

  describe('with an emailed code', () => {
    it('sends a code, then verifies the six digits typed back', async () => {
      const user = userEvent.setup()
      renderSignIn()

      const code = await sendCode(user)
      expect(auth.sendEmailCode).toHaveBeenCalledWith(EMAIL)
      expect(screen.getByText(/^We sent a 6-digit code to/)).toHaveTextContent(
        `We sent a 6-digit code to ${EMAIL}.`,
      )
      expect(code).toHaveAttribute('autocomplete', 'one-time-code')
      expect(code).toHaveAttribute('inputmode', 'numeric')

      await user.type(code, '123456')
      await user.click(screen.getByRole('button', { name: 'Verify code' }))

      expect(auth.verifyEmailCode).toHaveBeenCalledTimes(1)
      expect(auth.verifyEmailCode).toHaveBeenCalledWith(EMAIL, '123456')
    })

    it('carries the email over from the password form', async () => {
      const user = userEvent.setup()
      renderSignIn()

      await user.type(screen.getByLabelText('Email'), EMAIL)
      await user.click(screen.getByRole('button', { name: 'Email me a sign-in code instead' }))
      expect(screen.getByLabelText('Email')).toHaveValue(EMAIL)
      expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Use a password instead' }))
      expect(screen.getByLabelText('Email')).toHaveValue(EMAIL)
      expect(screen.getByLabelText('Password')).toBeInTheDocument()
    })

    it('does not send a code to something that is not an email', async () => {
      const user = userEvent.setup()
      renderSignIn()

      await user.click(screen.getByRole('button', { name: 'Email me a sign-in code instead' }))
      await user.click(screen.getByRole('button', { name: 'Send code' }))
      expect(screen.getByLabelText('Email')).toHaveAccessibleDescription('Enter your email.')

      await user.type(screen.getByLabelText('Email'), 'owner@')
      await user.click(screen.getByRole('button', { name: 'Send code' }))
      expect(screen.getByLabelText('Email')).toHaveAccessibleDescription('That doesn’t look like an email address.')

      expect(auth.sendEmailCode).not.toHaveBeenCalled()
    })

    it('says why the code could not be sent and stays on the email step', async () => {
      const user = userEvent.setup()
      auth.sendEmailCode.mockRejectedValue(new ServiceError('unauthorized', 'There is no account for that email.'))
      renderSignIn()

      await user.click(screen.getByRole('button', { name: 'Email me a sign-in code instead' }))
      await user.type(screen.getByLabelText('Email'), EMAIL)
      await user.click(screen.getByRole('button', { name: 'Send code' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('There is no account for that email.')
      expect(screen.getByLabelText('Email')).toHaveValue(EMAIL)
      expect(screen.queryByLabelText('Code')).not.toBeInTheDocument()
    })

    it('takes only digits, and wants all six before checking', async () => {
      const user = userEvent.setup()
      renderSignIn()
      const code = await sendCode(user)

      await user.type(code, '12a3')
      expect(code).toHaveValue('123')
      await user.click(screen.getByRole('button', { name: 'Verify code' }))

      expect(code).toHaveAccessibleDescription(/Enter all 6 digits of the code\./)
      expect(code).toHaveValue('123')
      expect(auth.verifyEmailCode).not.toHaveBeenCalled()
    })

    it('accepts a code pasted with a space in it', async () => {
      const user = userEvent.setup()
      renderSignIn()
      const code = await sendCode(user)

      await user.click(code)
      await user.paste('123 456')

      expect(code).toHaveValue('123456')
    })

    it('says when the code is wrong and keeps it for fixing', async () => {
      const user = userEvent.setup()
      auth.verifyEmailCode.mockRejectedValue(new ServiceError('unauthorized', 'That code is wrong or has expired.'))
      renderSignIn()
      const code = await sendCode(user)

      await user.type(code, '654321')
      await user.click(screen.getByRole('button', { name: 'Verify code' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('That code is wrong or has expired.')
      expect(code).toHaveValue('654321')
    })

    it('makes the owner wait 30 seconds before asking for another code', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderSignIn()
      await sendCode(user)

      expect(screen.getByRole('button', { name: 'Send a new code in 30s' })).toBeDisabled()

      act(() => {
        vi.advanceTimersByTime(12_000)
      })
      expect(screen.getByRole('button', { name: 'Send a new code in 18s' })).toBeDisabled()

      act(() => {
        vi.advanceTimersByTime(18_000)
      })
      const resend = screen.getByRole('button', { name: 'Send a new code' })
      expect(resend).toBeEnabled()

      await user.click(resend)

      await waitFor(() => expect(auth.sendEmailCode).toHaveBeenCalledTimes(2))
      expect(auth.sendEmailCode).toHaveBeenLastCalledWith(EMAIL)
      expect(await screen.findByText('New code sent')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^Send a new code in \d+s$/ })).toBeDisabled()
    })
  })
})
