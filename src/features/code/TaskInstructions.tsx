import { useId, useLayoutEffect, useRef, useState } from 'react'

import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { Section } from '@/components/ui/Page'

/** What the owner asked for, folded to four lines when it runs long. */
export function TaskInstructions({ text }: { text: string }) {
  const id = useId()
  const ref = useRef<HTMLParagraphElement>(null)
  const [expanded, setExpanded] = useState(false)
  // Whether four lines cut the text short. Only measurable while folded.
  const [long, setLong] = useState(false)

  useLayoutEffect(() => {
    if (expanded) return
    const measure = () => {
      const paragraph = ref.current
      if (paragraph) setLong(paragraph.scrollHeight > paragraph.clientHeight + 1)
    }
    measure()
    // Line breaks move when the window is resized and when the fonts arrive.
    window.addEventListener('resize', measure)
    void document.fonts?.ready.then(measure)
    return () => window.removeEventListener('resize', measure)
  }, [expanded, text])

  return (
    <Section title="Instructions">
      <p
        ref={ref}
        id={id}
        className={cn('whitespace-pre-line text-base text-ash wrap-anywhere', !expanded && 'line-clamp-4')}
      >
        {text}
      </p>
      {long || expanded ? (
        <Button
          variant="ghost"
          className="-ml-4 mt-1"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? 'Show less' : 'Show all'}
        </Button>
      ) : null}
    </Section>
  )
}
