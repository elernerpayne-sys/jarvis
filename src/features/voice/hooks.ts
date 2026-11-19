import { useSyncExternalStore } from 'react'

function subscribeToConnection(onChange: () => void): () => void {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

/** False while the browser reports no network at all. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeToConnection,
    () => navigator.onLine,
    () => true,
  )
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

function subscribeToMotionPreference(onChange: () => void): () => void {
  const query = window.matchMedia?.(REDUCED_MOTION)
  query?.addEventListener('change', onChange)
  return () => query?.removeEventListener('change', onChange)
}

/** True when the owner has asked their device for less motion. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeToMotionPreference,
    () => window.matchMedia?.(REDUCED_MOTION).matches === true,
    () => false,
  )
}
