import { useEffect, useId } from 'react'
import { Mic } from 'lucide-react'

import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Form'
import { Dot } from '@/components/ui/StatusDot'
import type { Dictation } from '@/features/code/useDictation'

/** The backend accepts instructions of 1 to 8000 characters. */
export const MAX_INSTRUCTIONS = 8000
/** The counter stays out of the way until the limit is in sight. */
const COUNTER_FROM = 7000

/** Adds spoken words to the end of the text, one space apart, within the limit. */
export function appendSpoken(text: string, spoken: string): string {
  if (!spoken) return text
  const joined = text === '' || /\s$/.test(text) ? text + spoken : `${text} ${spoken}`
  return joined.slice(0, MAX_INSTRUCTIONS)
}

function DictateButton({ dictation }: { dictation: Dictation }) {
  const { listening } = dictation
  return (
    <Button
      variant="ghost"
      aria-pressed={listening}
      onClick={listening ? dictation.stop : dictation.start}
      icon={listening ? <Dot tone="amber" pulse /> : <Mic aria-hidden className="size-4" />}
      className={cn('-mr-2', listening && 'bg-raised-2 text-bone')}
    >
      {listening ? 'Stop' : 'Dictate'}
    </Button>
  )
}

/**
 * "What should Jarvis do?": a text box the owner can type or dictate into.
 * While dictating, the words of the phrase in progress show at the end of the
 * text; they join `value` once the phrase is finished.
 */
export function InstructionsField({
  value,
  onChange,
  error,
  dictation,
}: {
  value: string
  onChange: (value: string) => void
  /** What is wrong with the text, shown under it. */
  error?: string | null
  dictation: Dictation
}) {
  const id = useId()
  const noteId = `${id}-note`
  const shown = appendSpoken(value, dictation.interim)
  // Browsers that cannot dictate get a tip in place of the button.
  const tip = dictation.supported ? null : 'Tip: use the microphone key on your keyboard to dictate.'
  const note = error || tip

  // Keep the newest words in view while dictating into a long text.
  useEffect(() => {
    if (!dictation.listening) return
    const textarea = document.getElementById(id)
    if (textarea) textarea.scrollTop = textarea.scrollHeight
  }, [dictation.listening, shown, id])

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="block text-sm text-ash">
          What should Jarvis do?
        </label>
        {dictation.supported ? <DictateButton dictation={dictation} /> : null}
      </div>
      <Textarea
        id={id}
        rows={6}
        maxLength={MAX_INSTRUCTIONS}
        value={shown}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={note ? noteId : undefined}
      />
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          {note ? (
            <p id={noteId} className={cn('text-sm', error ? 'text-bad' : 'text-smoke')}>
              {note}
            </p>
          ) : null}
          {dictation.error ? (
            <p role="alert" className="text-sm text-bad">
              {dictation.error}
            </p>
          ) : null}
        </div>
        {shown.length > COUNTER_FROM ? (
          <p className="shrink-0 text-sm text-smoke tabular-nums">
            {shown.length.toLocaleString()} of {MAX_INSTRUCTIONS.toLocaleString()}
          </p>
        ) : null}
      </div>
    </div>
  )
}
