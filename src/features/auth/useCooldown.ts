import { useCallback, useEffect, useState } from 'react'

/**
 * A countdown for "wait before asking again". `start()` begins it;
 * `secondsLeft` falls to 0 when it is over.
 */
export function useCooldown(seconds: number): { secondsLeft: number; start: () => void } {
  const [endsAt, setEndsAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (endsAt === null) return
    // Measured against the clock rather than counted in ticks, so it stays
    // right when the phone throttles timers in the background.
    const timer = setInterval(() => {
      const time = Date.now()
      if (time >= endsAt) setEndsAt(null)
      else setNow(time)
    }, 1000)
    return () => clearInterval(timer)
  }, [endsAt])

  const start = useCallback(() => {
    const time = Date.now()
    setNow(time)
    setEndsAt(time + seconds * 1000)
  }, [seconds])

  const secondsLeft = endsAt === null ? 0 : Math.max(0, Math.ceil((endsAt - now) / 1000))
  return { secondsLeft, start }
}
