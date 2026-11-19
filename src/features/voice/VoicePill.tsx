import { Link, useLocation } from 'react-router'

import { routes } from '@/lib/links'
import { Dot } from '@/components/ui/StatusDot'
import { useVoice } from '@/features/voice/context'
import { presenceOf } from '@/features/voice/presence'
import type { Presence } from '@/features/voice/presence'

const PILL_LABEL: Partial<Record<Presence, string>> = {
  listening: 'Jarvis is listening',
  muted: 'You’re muted',
  speaking: 'Jarvis is speaking',
  chatting: 'Chatting with Jarvis',
}

/**
 * A reminder that a conversation is still going when the owner has left
 * Home: press it to go back, or end the conversation from here.
 *
 * On a phone it floats just above the tab bar; on a desktop it sits in the
 * bottom-right corner. Toasts are stacked above it (they are on a higher
 * layer), so a new alert is never hidden behind the pill.
 */
export function VoicePill() {
  const { controller } = useVoice()
  const { pathname } = useLocation()

  const label = PILL_LABEL[presenceOf(controller)]
  if (!label || pathname === routes.home) return null

  return (
    <div
      role="group"
      aria-label="Conversation with Jarvis"
      className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] left-1/2 z-40 flex -translate-x-1/2 items-center whitespace-nowrap rounded-2xl border border-line-strong bg-raised-3 text-sm shadow-lg shadow-black/40 lg:bottom-6 lg:left-auto lg:right-6 lg:translate-x-0"
    >
      <Link
        to={routes.home}
        className="flex h-12 items-center gap-2.5 rounded-l-2xl pl-4 pr-3.5 text-bone"
      >
        <Dot tone="amber" pulse />
        {label}
      </Link>
      <span aria-hidden className="h-5 w-px bg-line-strong" />
      <button
        type="button"
        onClick={controller.stop}
        className="h-12 rounded-r-2xl pl-3.5 pr-4 font-medium text-ash transition-colors hover:text-bone"
      >
        End
      </button>
    </div>
  )
}
