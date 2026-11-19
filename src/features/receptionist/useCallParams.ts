import { useEffect, useRef } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'

import type { CallFilter } from '@/lib/types'

const FILTER_PARAM = 'filter'
const CALL_PARAM = 'call'

/** Left on the history entry this screen adds when a call row is pressed. */
const OPENED_HERE = { callOpenedHere: true } as const

function wasOpenedHere(state: unknown): boolean {
  return (
    typeof state === 'object' && state !== null && 'callOpenedHere' in state && state.callOpenedHere === true
  )
}

export interface CallParams {
  /** Which calls the list shows. Lives in `?filter=`, so refresh and back keep it. */
  filter: CallFilter
  /** The call whose transcript is open, from `?call=`. */
  callId: string | null
  setFilter: (filter: CallFilter) => void
  openCall: (id: string) => void
  closeCall: () => void
}

/**
 * The shop screen's state that lives in the URL, so an alert can link straight
 * to a call and the back button closes it again.
 */
export function useCallParams(): CallParams {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()

  const filter: CallFilter = params.get(FILTER_PARAM) === 'problems' ? 'problems' : 'all'
  const callId = params.get(CALL_PARAM) || null
  const openedHere = wasOpenedHere(location.state)

  // One close can arrive twice (Escape, then a tap) before the URL has
  // changed. Going back twice would leave the shop.
  const goingBack = useRef(false)
  useEffect(() => {
    goingBack.current = false
  }, [callId])

  function setFilter(next: CallFilter) {
    // Replace: switching the filter should not pile up entries behind Back.
    setParams(
      (current) => {
        const updated = new URLSearchParams(current)
        if (next === 'all') updated.delete(FILTER_PARAM)
        else updated.set(FILTER_PARAM, next)
        return updated
      },
      { replace: true },
    )
  }

  function openCall(id: string) {
    setParams(
      (current) => {
        const updated = new URLSearchParams(current)
        updated.set(CALL_PARAM, id)
        return updated
      },
      { state: OPENED_HERE },
    )
  }

  function closeCall() {
    if (openedHere) {
      // We added an entry to open this call, so closing steps back onto the
      // list it was opened from instead of leaving a second copy behind it.
      if (goingBack.current) return
      goingBack.current = true
      void navigate(-1)
      return
    }
    // Arrived by link (an alert, a reload in a new tab): nothing of ours to
    // go back to, so drop the parameter in place.
    setParams(
      (current) => {
        const updated = new URLSearchParams(current)
        updated.delete(CALL_PARAM)
        return updated
      },
      { replace: true },
    )
  }

  return { filter, callId, setFilter, openCall, closeCall }
}
