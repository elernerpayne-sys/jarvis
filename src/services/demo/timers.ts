/**
 * Every timer the demo starts goes through here, so `dispose()` can cancel
 * them all in one go and tests never leak a pending timeout.
 */
export interface Timers {
  /** Runs `task` once after `ms`. Returns a function that cancels it. */
  after(ms: number, task: () => void): () => void
  /** Resolves after `ms`. Resolves straight away once the timers are cleared. */
  sleep(ms: number): Promise<void>
  /** Cancels everything pending and refuses new timers from then on. */
  clear(): void
}

type Handle = ReturnType<typeof setTimeout>

/** In Node, a pending demo timer should not keep the process alive. */
function unref(handle: unknown): void {
  if (
    typeof handle === 'object' &&
    handle !== null &&
    'unref' in handle &&
    typeof handle.unref === 'function'
  ) {
    handle.unref()
  }
}

export function createTimers(): Timers {
  // Each pending timer, with what to do if it is cleared before it fires.
  const pending = new Map<Handle, (() => void) | null>()
  let closed = false

  function start(ms: number, task: () => void, onClear: (() => void) | null): Handle {
    const handle = setTimeout(() => {
      pending.delete(handle)
      task()
    }, ms)
    unref(handle)
    pending.set(handle, onClear)
    return handle
  }

  return {
    after(ms, task) {
      if (closed) return () => {}
      const handle = start(ms, task, null)
      return () => {
        clearTimeout(handle)
        pending.delete(handle)
      }
    },

    sleep(ms) {
      if (closed || ms <= 0) return Promise.resolve()
      // A cleared sleep still resolves, so nobody is left waiting forever.
      return new Promise<void>((resolve) => {
        start(ms, resolve, resolve)
      })
    },

    clear() {
      closed = true
      const waiting = [...pending.entries()]
      pending.clear()
      for (const [handle, onClear] of waiting) {
        clearTimeout(handle)
        onClear?.()
      }
    },
  }
}
