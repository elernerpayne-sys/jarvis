/**
 * Demo scenarios, for looking at the states a screen can be in.
 *
 * Add `?demo=empty`, `?demo=error` or `?demo=slow` to the page address. The
 * choice is remembered for the browser tab, so it survives moving between
 * screens and reloading. `?demo=off` goes back to the normal sample data.
 *
 *   empty  every list is empty and the brief is all zeros
 *   error  nothing can be loaded or saved; the app shows its error states
 *   slow   everything loads after about 2.5 seconds
 */
export type DemoScenario = 'empty' | 'error' | 'slow'

const SCENARIOS: readonly DemoScenario[] = ['empty', 'error', 'slow']
const STORAGE_KEY = 'jarvis.demo'

function isScenario(value: string | null): value is DemoScenario {
  return SCENARIOS.some((scenario) => scenario === value)
}

function fromAddress(): string | null {
  try {
    return new URLSearchParams(window.location.search).get('demo')
  } catch {
    return null
  }
}

// Session storage can be missing or blocked (private windows, tests, SSR).
function remembered(): DemoScenario | null {
  try {
    const value = window.sessionStorage.getItem(STORAGE_KEY)
    return isScenario(value) ? value : null
  } catch {
    return null
  }
}

function remember(scenario: DemoScenario | null): void {
  try {
    if (scenario) window.sessionStorage.setItem(STORAGE_KEY, scenario)
    else window.sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to do: the scenario just won't survive a reload.
  }
}

/** The scenario asked for in the page address, or the one remembered earlier. */
export function readScenario(): DemoScenario | null {
  if (typeof window === 'undefined') return null

  const requested = fromAddress()
  if (requested === 'off') {
    remember(null)
    return null
  }
  if (isScenario(requested)) {
    remember(requested)
    return requested
  }
  return remembered()
}
