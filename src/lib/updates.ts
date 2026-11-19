/**
 * App updates for the installed PWA.
 *
 * A new version is downloaded in the background and takes over on its own.
 * The page then has to reload to use it, but never at a bad moment: not in
 * the middle of a conversation with Jarvis, and not while you are typing.
 * So the reload waits for a natural break: the next time you switch screens,
 * or the next time the app goes to the background.
 */
import { registerSW } from 'virtual:pwa-register'

let updateWaiting = false
let holds = 0

function reloadIfFree(): boolean {
  if (!updateWaiting || holds > 0) return false
  updateWaiting = false
  window.location.reload()
  return true
}

/** Call once at startup. Does nothing in development. */
export function initAppUpdates(): void {
  registerSW({
    immediate: true,
    onNeedReload() {
      updateWaiting = true
      if (document.visibilityState === 'hidden') reloadIfFree()
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return
      // An app left open for days still picks up new versions.
      setInterval(() => void registration.update().catch(() => {}), 60 * 60 * 1000)
    },
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') reloadIfFree()
  })
}

/**
 * Reloads into the new version if one is waiting and nothing is holding it
 * back. Called when the owner moves to another screen. Returns true when a
 * reload has started.
 */
export function applyWaitingUpdate(): boolean {
  return reloadIfFree()
}

/**
 * Keeps the app from reloading while something must not be interrupted (a
 * live conversation). Returns the function that lifts the hold.
 */
export function holdUpdates(): () => void {
  holds += 1
  let released = false
  return () => {
    if (released) return
    released = true
    holds -= 1
  }
}
