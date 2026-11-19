import { formatDateOnly } from '@/lib/format'
import type { Decision } from '@/lib/types'
import { useDeleteDecision, useSaveDecision } from '@/services/hooks'
import { Field, Input, Textarea } from '@/components/ui/Form'
import { ItemSheet } from '@/features/memory/ItemSheet'
import type { ItemCopy } from '@/features/memory/ItemSheet'
import { TagList } from '@/features/memory/TagList'
import { TagsField } from '@/features/memory/TagsField'
import { toDecisionDraft, toDecisionInput, validateDecisionDraft } from '@/features/memory/decisions'
import type { DecisionDraft } from '@/features/memory/decisions'
import type { FieldsProps } from '@/features/memory/types'

const COPY: ItemCopy = {
  newTitle: 'New decision',
  editTitle: 'Edit decision',
  save: 'Save decision',
  saved: 'Decision saved',
  saveFailed: 'Couldn’t save the decision.',
  remove: 'Delete decision',
  confirmRemove: 'Delete this decision?',
  removed: 'Decision deleted',
  removeFailed: 'Couldn’t delete the decision.',
}

const BODY = 'mt-1.5 max-w-prose whitespace-pre-line break-words text-base leading-7 text-bone'

/** The decision as it reads: when, what was decided, and why. */
function DecisionView({ decision }: { decision: Decision }) {
  return (
    <div className="space-y-5">
      <p className="text-sm text-ash">
        Decided on <time dateTime={decision.decided_on}>{formatDateOnly(decision.decided_on)}</time>
      </p>
      <div className="divide-y divide-line border-y border-line">
        <section className="py-4">
          <h3 className="text-sm text-ash">Decision</h3>
          <p className={BODY}>{decision.decision}</p>
        </section>
        <section className="py-4">
          <h3 className="text-sm text-ash">Why</h3>
          {decision.rationale ? (
            <p className={BODY}>{decision.rationale}</p>
          ) : (
            <p className="mt-1.5 text-base text-smoke">No reason written down yet.</p>
          )}
        </section>
      </div>
      <TagList tags={decision.tags} label="Tags" />
    </div>
  )
}

function DecisionFields({ draft, errors, onChange }: FieldsProps<DecisionDraft>) {
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
      <Field label="Decision" error={errors.decision}>
        {(field) => (
          <Textarea
            {...field}
            name="decision"
            rows={3}
            required
            value={draft.decision}
            onChange={(event) => onChange({ decision: event.target.value })}
          />
        )}
      </Field>
      <Field label="Why" hint="Optional.">
        {(field) => (
          <Textarea
            {...field}
            name="rationale"
            rows={4}
            value={draft.rationale}
            onChange={(event) => onChange({ rationale: event.target.value })}
          />
        )}
      </Field>
      <Field label="Decided on" error={errors.decided_on}>
        {(field) => (
          <Input
            {...field}
            type="date"
            name="decided_on"
            required
            value={draft.decided_on}
            onChange={(event) => onChange({ decided_on: event.target.value })}
            // iOS centres the value of a date field; keep it in line with the rest.
            className="[&::-webkit-date-and-time-value]:text-left"
          />
        )}
      </Field>
      <TagsField value={draft.tags} onChange={(tags) => onChange({ tags })} />
    </>
  )
}

/**
 * Reads, adds, edits and deletes one decision.
 * Mount it with a new `key` each time it opens (see `ItemSheet`).
 */
export function DecisionSheet({
  open,
  decision,
  onClose,
}: {
  open: boolean
  /** The decision to read. Null starts a new one. */
  decision: Decision | null
  onClose: () => void
}) {
  const save = useSaveDecision()
  const remove = useDeleteDecision()
  return (
    <ItemSheet
      open={open}
      item={decision}
      copy={COPY}
      toDraft={toDecisionDraft}
      validate={validateDecisionDraft}
      onSave={(draft, id) => save.mutateAsync(toDecisionInput(draft, id))}
      onDelete={(id) => remove.mutateAsync(id)}
      renderRead={(current) => <DecisionView decision={current} />}
      renderFields={(fields) => <DecisionFields {...fields} />}
      onClose={onClose}
    />
  )
}
