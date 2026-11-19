import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { AudioLines, Mic } from 'lucide-react'

import { cn } from '@/lib/cn'
import { useReducedMotion } from '@/features/voice/hooks'

import './talk.css'

/**
 * How the button looks.
 * - idle: a slow breathing halo, inviting a tap
 * - off: it can't be pressed right now (still loading, offline)
 * - connecting: the ring pulses while the conversation opens
 * - listening / speaking: the light follows the voice
 */
export type TalkLook = 'idle' | 'off' | 'connecting' | 'listening' | 'speaking'

/** How quickly the ring rises to a sound, and how gently it lets go. */
const ATTACK_MS = 70
const RELEASE_MS = 380
const TRAIL_MS = 520

/**
 * Speech reports a loudness well under 1. This lifts quiet speech into
 * view and flattens the top, so a shout never slams the ring to full size.
 */
function shape(volume: number): number {
  return 1 - Math.exp(-Math.max(0, volume) * 5)
}

/**
 * Writes the current loudness onto the element as `--level` and
 * `--level-slow`, once per animation frame, straight to the DOM: React never
 * re-renders for it. Pass `null` to stop.
 */
function useVolumeLevel(target: RefObject<HTMLElement | null>, getVolume: (() => number) | null) {
  useEffect(() => {
    const element = target.current
    if (!element || !getVolume || typeof requestAnimationFrame !== 'function') return

    let frame = 0
    let level = 0
    let trail = 0
    let last = performance.now()

    const tick = (now: number) => {
      // Time-based easing looks the same at 60Hz and 120Hz. The cap keeps a
      // backgrounded tab from snapping when it wakes.
      const elapsed = Math.min(100, Math.max(0, now - last))
      last = now
      const heard = shape(getVolume())
      level += (heard - level) * (1 - Math.exp(-elapsed / (heard > level ? ATTACK_MS : RELEASE_MS)))
      trail += (level - trail) * (1 - Math.exp(-elapsed / TRAIL_MS))
      element.style.setProperty('--level', level.toFixed(3))
      element.style.setProperty('--level-slow', trail.toFixed(3))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      element.style.removeProperty('--level')
      element.style.removeProperty('--level-slow')
    }
  }, [target, getVolume])
}

/**
 * The hero: one large round button inside a soft ring of light.
 * It is a toggle. Its name stays "Talk to Jarvis"; `pressed` says whether a
 * spoken conversation is on, and the status line under it (`describedBy`)
 * says what is happening.
 */
export function TalkButton({
  look,
  pressed,
  disabled = false,
  describedBy,
  getVolume,
  onPress,
}: {
  look: TalkLook
  pressed: boolean
  disabled?: boolean
  describedBy?: string
  getVolume: () => number
  onPress: () => void
}) {
  const halo = useRef<HTMLDivElement>(null)
  const reducedMotion = useReducedMotion()
  const voiced = look === 'listening' || look === 'speaking'
  useVolumeLevel(halo, voiced && !reducedMotion ? getVolume : null)

  const Icon = look === 'speaking' ? AudioLines : Mic

  return (
    <div ref={halo} className="talk" data-state={look}>
      <span aria-hidden className={cn('talk-glow', look === 'idle' && 'animate-breathe')} />
      <span aria-hidden className="talk-ripple" />
      <span aria-hidden className={cn('talk-ring', look === 'connecting' && 'animate-pulse-dot')} />
      <button
        type="button"
        aria-label="Talk to Jarvis"
        aria-pressed={pressed}
        aria-describedby={describedBy}
        disabled={disabled}
        onClick={onPress}
        className={cn(
          'talk-core relative grid size-42 place-items-center rounded-full border transition-[border-color,color,scale] duration-200',
          'focus-visible:outline-offset-4 active:scale-[0.98] disabled:active:scale-100 lg:size-50',
          look === 'off' ? 'border-line text-smoke' : 'border-line-strong text-amber',
          voiced && 'border-amber/60',
          look === 'speaking' && 'text-bone',
        )}
      >
        <span aria-hidden className="talk-light" />
        <Icon aria-hidden className={cn('relative size-10 lg:size-11', look === 'connecting' && 'opacity-60')} strokeWidth={1.5} />
      </button>
    </div>
  )
}
