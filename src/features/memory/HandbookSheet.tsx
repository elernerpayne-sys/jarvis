import { useId } from 'react'

import type { HandbookEntry } from '@/lib/types'
import { useDeleteHandbookEntry, useSaveHandbookEntry } from '@/services/hooks'
import { Field, Input, Textarea } from '@/components/ui/Form'
import { Tag } from '@/components/ui/Page'
import { ItemSheet } from '@/features/memory/ItemSheet'
import type { ItemCopy } from '@/features/memory/ItemSheet'
import { TagsField } from '@/features/memory/TagsField'
import { toHandbookDraft, toHandbookInput, validateHandbookDraft } from '@/features/memory/handbook'
import type { HandbookDraft } from '@/features/memory/handbook'
import type { FieldsProps } from '@/features/memory/types'

const COPY: ItemCopy = {
  newTitle: 'New entry',
  editTitle: 'Edit entry',
  save: 'Save entry',
  saved: 'Entry saved',
  saveFailed: 'Couldn’t save the entry.',
  remove: 'Delete entry',
  confirmRemove: 'Delete this entry?',
  removed: 'Entry deleted',
  removeFailed: 'Couldn’t delete the entry.',
}

/** The entry as it reads: where it belongs, then everything it says. */
function HandbookEntryView({ entry }: { entry: HandbookEntry }) {
  const category = entry.category.trim()
  return (
    <div className="space-y-5">
      {category || entry.tags.length > 0 ? (
        <ul aria-label="Category and tags" className="flex flex-wrap gap-2">
          {category ? (
            <li className="flex">
              <Tag className="text-bone">{category}</Tag>
            </li>
          ) : null}
          {entry.tags.map((tag) => (
            <li key={tag} className="flex">
              <Tag>{tag}</Tag>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="max-w-prose whitespace-pre-line break-words text-base leading-7 text-bone">
        {entry.content}
      </p>
    </div>
  )
}

function HandbookFields({
  draft,
  errors,
  onChange,
  categories,
}: FieldsProps<HandbookDraft> & { categories: readonly string[] }) {
  const categoryListId = useId()
  return (
    <>
      <Field label="Title" error={errors.title}>
        {(field) => (
          <Input
            {...field}
            name="title"
            required
            autoComplete="off"
            value={draft.title}
            onChange={(event) => onChange({ title: event.target.value })}
          />
        )}
      </Field>
      <Field label="Category">
        {(field) => (
          <Input
            {...field}
            name="category"
            list={categoryListId}
            autoComplete="off"
            value={draft.category}
            onChange={(event) => onChange({ category: event.target.value })}
          />
        )}
      </Field>
      {/* Offers the categories already in use; typing a new one works too. */}
      <datalist id={categoryListId}>
        {categories.map((category) => (
          <option key={category} value={category} />
        ))}
      </datalist>
      <Field label="Content" error={errors.content}>
        {(field) => (
          <Textarea
            {...field}
            name="content"
            rows={8}
            required
            value={draft.content}
            onChange={(event) => onChange({ content: event.target.value })}
          />
        )}
      </Field>
      <TagsField value={draft.tags} onChange={(tags) => onChange({ tags })} />
    </>
  )
}

/**
 * Reads, adds, edits and deletes one handbook entry.
 * Mount it with a new `key` each time it opens (see `ItemSheet`).
 */
export function HandbookSheet({
  open,
  entry,
  categories,
  onClose,
}: {
  open: boolean
  /** The entry to read. Null starts a new one. */
  entry: HandbookEntry | null
  /** Categories already in use, offered while typing one. */
  categories: readonly string[]
  onClose: () => void
}) {
  const save = useSaveHandbookEntry()
  const remove = useDeleteHandbookEntry()
  return (
    <ItemSheet
      open={open}
      item={entry}
      copy={COPY}
      toDraft={toHandbookDraft}
      validate={validateHandbookDraft}
      onSave={(draft, id) => save.mutateAsync(toHandbookInput(draft, id))}
      onDelete={(id) => remove.mutateAsync(id)}
      renderRead={(current) => <HandbookEntryView entry={current} />}
      renderFields={(fields) => <HandbookFields {...fields} categories={categories} />}
      onClose={onClose}
    />
  )
}
