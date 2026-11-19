import { useEffect, useState } from 'react'

/**
 * The current time, refreshed every minute, so "4m ago" and the "Today"
 * heading stay true while the screen sits open.
 */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
