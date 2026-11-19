import { useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowUp } from 'lucide-react'

import { cn } from '@/lib/cn'
import { IconButton } from '@/components/ui/Button'
import { Input } from '@/components/ui/Form'

/**
 * The typed way to talk to Jarvis: one field and a send button. Enter sends.
 * The field keeps focus after sending so the next message can follow.
 */
export function Composer({
  canSend,
  autoFocus = false,
  onSend,
  onTyping,
  className,
}: {
  /** False while a message could not go anywhere (connecting, offline). */
  canSend: boolean
  /** Put the cursor in the field as soon as it appears. */
  autoFocus?: boolean
  onSend: (text: string) => void
  onTyping: () => void
  className?: string
}) {
  const [draft, setDraft] = useState('')
  const ready = canSend && draft.trim() !== ''

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!ready) return
    onSend(draft.trim())
    setDraft('')
    // Pressing the send button moves focus to it; hand it back to the field.
    const field = event.currentTarget.elements.namedItem('message')
    if (field instanceof HTMLInputElement) field.focus()
  }

  return (
    <form onSubmit={handleSubmit} className={cn('flex items-center gap-2', className)}>
      <Input
        name="message"
        aria-label="Message Jarvis"
        placeholder="Message Jarvis"
        enterKeyHint="send"
        autoComplete="off"
        autoFocus={autoFocus}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value)
          onTyping()
        }}
      />
      <IconButton
        type="submit"
        label="Send"
        disabled={!ready}
        className="border border-line bg-raised-2 hover:border-line-strong"
      >
        {/* The colour sits on the icon so it can't fight the button's own. */}
        <ArrowUp aria-hidden className={cn('size-5', ready && 'text-amber')} />
      </IconButton>
    </form>
  )
}
