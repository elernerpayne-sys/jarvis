import { Field, Input } from '@/components/ui/Form'
import { TagList } from '@/features/memory/TagList'
import { parseTags } from '@/features/memory/tags'

/**
 * Tags typed on one line, separated by commas. What will be saved shows
 * underneath while typing, so a stray comma or a repeat is easy to spot.
 */
export function TagsField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="space-y-2">
      <Field label="Tags" hint="Separate tags with commas.">
        {(field) => (
          <Input
            {...field}
            name="tags"
            autoComplete="off"
            autoCapitalize="none"
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        )}
      </Field>
      <TagList tags={parseTags(value)} label="Tags as they will be saved" />
    </div>
  )
}
