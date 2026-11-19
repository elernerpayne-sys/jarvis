/**
 * "Add to home screen" support.
 *
 * Chrome and Android fire `beforeinstallprompt` once, early, often before the
 * Settings screen exists. `initInstallPrompt()` runs at startup, keeps hold of
 * that event, and `useInstall()` lets any screen offer the install later.
 * iPhone has no such event: there the owner uses Share → Add to Home Screen.
 */
import { useSyncExternalStore } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: BeforeInstallPromptEvent | null = null
let version = 0
const listeners = new Set<() => void>()

function notify() {
  version += 1
  for (const listener of listeners) listener()
}

/** Call once, before the app renders. */
export function initInstallPrompt(): void {
  if (typeof window === 'undefined') return
  window.addEventListener('beforeinstallprompt', (event) => {
    // Hold the browser's own banner so the app can offer it at a better moment.
    event.preventDefault()
    deferred = event as BeforeInstallPromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    notify()
  })
}

/** True when the app is already running from the home screen. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return iosStandalone || window.matchMedia?.('(display-mode: standalone)').matches === true
}

/** iPhone and iPad (including iPadOS pretending to be a Mac). */
export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferred
  if (!event) return 'unavailable'
  await event.prompt()
  const { outcome } = await event.userChoice
  // The event can only be used once.
  deferred = null
  notify()
  return outcome
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export interface InstallState {
  /** The browser can show its install dialog right now. */
  canPrompt: boolean
  /** Already installed and running from the home screen. */
  standalone: boolean
  /** On iPhone/iPad, where installing is a manual Share-menu step. */
  ios: boolean
  /** Shows the browser's install dialog. Resolves with what the owner chose. */
  prompt: () => Promise<'accepted' | 'dismissed' | 'unavailable'>
}

export function useInstall(): InstallState {
  useSyncExternalStore(subscribe, () => version, () => 0)
  return { canPrompt: deferred !== null, standalone: isStandalone(), ios: isIos(), prompt: promptInstall }
}
