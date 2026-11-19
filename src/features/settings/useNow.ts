import { useEffect, useState } from 'react'

/**
 * The current time, refreshed twice a minute, so lines like "Checked 4m ago"
 * and "Quiet hours are on right now" stay true while the screen sits open.
 */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
