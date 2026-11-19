import { Field, Input } from '@/components/ui/Form'

/** The owner's email, set up so password managers and phone keyboards help. */
export function EmailField({
  value,
  onChange,
  error,
}: {
  value: string
  onChange: (value: string) => void
  error: string | null
}) {
  return (
    <Field label="Email" error={error}>
      {(control) => (
        <Input
          {...control}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  )
}

/** Moves the cursor to the named field of a form, e.g. the first one with a problem. */
export function focusField(form: HTMLFormElement, name: string): void {
  const field = form.elements.namedItem(name)
  if (field instanceof HTMLElement) field.focus()
}
