import { useId, useRef } from 'react'
import type {
  InputHTMLAttributes,
  KeyboardEvent,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'
import { ChevronDown, Search, X } from 'lucide-react'

import { cn } from '@/lib/cn'

const CONTROL =
  'w-full rounded-xl border border-line bg-raised-2 px-4 text-base text-bone placeholder:text-smoke ' +
  'transition-colors focus:border-amber/60 disabled:opacity-50 aria-[invalid=true]:border-bad/60'

/**
 * A label, a control and an optional hint or error.
 * Give it a render function to receive the ids to put on the control:
 * `<Field label="Title">{(p) => <Input {...p} value=… />}</Field>`
 */
export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string
  hint?: string
  error?: string | null
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode
  className?: string
}) {
  const id = useId()
  const noteId = `${id}-note`
  const note = error || hint
  return (
    <div className={cn('space-y-2', className)}>
      <label htmlFor={id} className="block text-sm text-ash">
        {label}
      </label>
      {children({
        id,
        'aria-describedby': note ? noteId : undefined,
        'aria-invalid': error ? true : undefined,
      })}
      {note ? (
        <p id={noteId} className={cn('text-sm', error ? 'text-bad' : 'text-smoke')}>
          {note}
        </p>
      ) : null}
    </div>
  )
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(CONTROL, 'h-12', className)} {...rest} />
}

export function Textarea({ className, rows = 4, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={rows} className={cn(CONTROL, 'min-h-28 resize-y py-3 leading-6', className)} {...rest} />
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative block">
      <select className={cn(CONTROL, 'h-12 appearance-none pr-10', className)} {...rest}>
        {children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-smoke" />
    </span>
  )
}

/** A search box with a clear button. `label` is read by screen readers. */
export function SearchField({
  value,
  onChange,
  label,
  placeholder,
  className,
}: {
  value: string
  onChange: (value: string) => void
  label: string
  placeholder?: string
  className?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div className={cn('relative', className)}>
      <Search aria-hidden className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-smoke" />
      <input
        ref={ref}
        type="search"
        enterKeyHint="search"
        aria-label={label}
        placeholder={placeholder ?? label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(CONTROL, 'h-12 pl-11 pr-12 [&::-webkit-search-cancel-button]:hidden')}
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            onChange('')
            ref.current?.focus()
          }}
          className="absolute right-1 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-lg text-smoke hover:text-bone"
        >
          <X aria-hidden className="size-4" />
        </button>
      ) : null}
    </div>
  )
}

/** An on/off switch with its label on the left. */
export function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  hint?: string
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="flex min-h-12 items-center justify-between gap-4">
      <div className="min-w-0">
        <span id={`${id}-label`} className="block text-base text-bone">
          {label}
        </span>
        {hint ? (
          <span id={`${id}-hint`} className="mt-0.5 block text-sm text-ash">
            {hint}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={hint ? `${id}-hint` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-8 w-14 shrink-0 rounded-full border transition-colors disabled:opacity-50',
          checked ? 'border-amber bg-amber' : 'border-line-strong bg-raised-3',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'absolute left-1 top-1 size-[1.375rem] rounded-full transition-transform',
            checked ? 'translate-x-6 bg-amber-ink' : 'bg-ash',
          )}
        />
      </button>
    </div>
  )
}

export interface SegmentedOption<T extends string> {
  value: T
  label: string
}

/**
 * Pick one of a few options (a filter, a tab, a channel).
 * Behaves as a radio group: arrow keys move the selection.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = 'md',
  className,
}: {
  value: T
  onChange: (value: T) => void
  options: ReadonlyArray<SegmentedOption<T>>
  /** Names the group for screen readers. */
  label: string
  size?: 'sm' | 'md'
  className?: string
}) {
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
    if (step === 0) return
    event.preventDefault()
    const index = options.findIndex((option) => option.value === value)
    const next = options[(index + step + options.length) % options.length]
    if (!next) return
    onChange(next.value)
    const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')
    buttons[(index + step + options.length) % options.length]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={handleKeyDown}
      className={cn('flex rounded-xl border border-line bg-raised p-1', className)}
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              'min-w-0 flex-1 truncate rounded-lg px-2 transition-colors',
              size === 'sm' ? 'h-9 text-sm' : 'h-10 text-sm',
              selected ? 'bg-raised-3 font-medium text-bone' : 'text-ash hover:text-bone',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
