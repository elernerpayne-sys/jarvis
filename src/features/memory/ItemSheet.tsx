import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Trash2 } from 'lucide-react'

import { errorMessage } from '@/services/errors'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog, Sheet } from '@/components/ui/Sheet'
import { StatusDot } from '@/components/ui/StatusDot'
import { useToast } from '@/components/ui/Toast'
import type { DraftErrors, FieldsProps, MemoryItem } from '@/features/memory/types'

/** The words that differ between a handbook entry and a decision. */
export interface ItemCopy {
  /** Sheet title while writing a new one: "New entry". */
  newTitle: string
  /** Sheet title while changing an existing one: "Edit entry". */
  editTitle: string
  /** The saving button: "Save entry". */
  save: string
  /** Toast after saving: "Entry saved". */
  saved: string
  /** Starts the sentence shown when saving fails: "Couldn’t save the entry." */
  saveFailed: string
  /** The deleting button, and the confirming button after it: "Delete entry". */
  remove: string
  /** The question before deleting: "Delete this entry?" */
  confirmRemove: string
  /** Toast after deleting: "Entry deleted". */
  removed: string
  /** Starts the sentence shown when deleting fails: "Couldn’t delete the entry." */
  removeFailed: string
}

export interface ItemSheetProps<Item extends MemoryItem, Draft extends Record<keyof Draft, string>> {
  open: boolean
  /** The item to read. Null goes straight to an empty form for a new one. */
  item: Item | null
  copy: ItemCopy
  toDraft: (item: Item | null) => Draft
  /** Checked when the owner saves. List problems in the order the fields appear. */
  validate: (draft: Draft) => DraftErrors<Draft>
  /** `id` is set when an existing item is being changed. */
  onSave: (draft: Draft, id: string | undefined) => Promise<Item>
  onDelete: (id: string) => Promise<void>
  renderRead: (item: Item) => ReactNode
  /** Give every control a `name` matching its draft key. */
  renderFields: (fields: FieldsProps<Draft>) => ReactNode
  onClose: () => void
}

type Mode = 'read' | 'edit'

/** Where leaving the form takes you: back to reading, or out of the sheet. */
type Destination = 'read' | 'closed'

const TRY_AGAIN = 'Check your connection and try again.'

function sameDraft<Draft extends Record<keyof Draft, string>>(a: Draft, b: Draft): boolean {
  return (Object.keys(a) as Array<keyof Draft>).every((key) => a[key] === b[key])
}

/**
 * One handbook entry or decision in a sheet. It opens for reading; "Edit"
 * turns the same sheet into a form, and saving turns it back. Leaving a form
 * with unsaved changes asks first, and so does deleting.
 *
 * State starts from `item` and is not reset afterwards: mount it with a new
 * `key` each time it opens.
 */
export function ItemSheet<Item extends MemoryItem, Draft extends Record<keyof Draft, string>>({
  open,
  item,
  copy,
  toDraft,
  validate,
  onSave,
  onDelete,
  renderRead,
  renderFields,
  onClose,
}: ItemSheetProps<Item, Draft>) {
  const toast = useToast()
  const formId = useId()
  const editButtonId = useId()

  // The item as last saved. Stays null while a new one is being written.
  const [current, setCurrent] = useState(item)
  const [mode, setMode] = useState<Mode>(item ? 'read' : 'edit')
  const [draft, setDraft] = useState(() => toDraft(item))
  // Problems stay out of sight until the first attempt to save.
  const [attempted, setAttempted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveFailure, setSaveFailure] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)
  // Where the owner was heading when we stopped to ask about unsaved changes.
  const [leavingTo, setLeavingTo] = useState<Destination | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteFailure, setDeleteFailure] = useState<string | null>(null)

  const errors = attempted ? validate(draft) : {}
  const dirty = mode === 'edit' && !sameDraft(draft, toDraft(current))

  // The footer buttons swap between modes, which would strand keyboard focus:
  // a form starts in its first field, and leaving it lands on "Edit".
  const previousMode = useRef(mode)
  useEffect(() => {
    if (!open) return
    if (mode === 'edit') {
      document.getElementById(formId)?.querySelector<HTMLElement>('input, textarea')?.focus()
    } else if (previousMode.current === 'edit') {
      document.getElementById(editButtonId)?.focus()
    }
    previousMode.current = mode
  }, [open, mode, formId, editButtonId])

  // The form can be scrolled anywhere when saving fails: bring the reason into view.
  const failureRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (saveFailure) failureRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [saveFailure])

  function startEditing() {
    setDraft(toDraft(current))
    setAttempted(false)
    setSaveFailure(null)
    setJustSaved(false)
    setMode('edit')
  }

  function leave(to: Destination) {
    setLeavingTo(null)
    if (to === 'closed') onClose()
    else setMode('read')
  }

  /** Leaves the form, asking first when there is something to lose. */
  function leaveForm(to: Destination) {
    if (saving) return
    if (dirty) setLeavingTo(to)
    else leave(to)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return

    const firstProblem = Object.keys(validate(draft))[0]
    if (firstProblem) {
      setAttempted(true)
      const field = event.currentTarget.elements.namedItem(firstProblem)
      if (field instanceof HTMLElement) field.focus()
      return
    }

    setSaving(true)
    setSaveFailure(null)
    try {
      const saved = await onSave(draft, current?.id)
      toast(copy.saved, { tone: 'ok' })
      if (current) {
        setCurrent(saved)
        setJustSaved(true)
        setMode('read')
      } else {
        onClose()
      }
    } catch (error) {
      setSaveFailure(errorMessage(error, TRY_AGAIN))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!current || deleting) return
    setDeleting(true)
    setDeleteFailure(null)
    try {
      await onDelete(current.id)
      toast(copy.removed)
      setConfirmingDelete(false)
      onClose()
    } catch (error) {
      setDeleteFailure(errorMessage(error, TRY_AGAIN))
    } finally {
      setDeleting(false)
    }
  }

  const reading = mode === 'read' && current !== null

  return (
    <>
      <Sheet
        open={open}
        onClose={() => (reading ? onClose() : leaveForm('closed'))}
        title={reading ? current.title : current ? copy.editTitle : copy.newTitle}
        busy={saving}
        footer={
          reading ? (
            <>
              {/* Distinct keys: if React reused the "Edit" element as the submit
                  button, the click that opens the form would also submit it. */}
              <Button key="close" size="lg" variant="ghost" onClick={onClose}>
                Close
              </Button>
              <Button key="edit" size="lg" id={editButtonId} onClick={startEditing}>
                Edit
              </Button>
            </>
          ) : (
            <>
              <Button key="cancel" size="lg" onClick={() => leaveForm(current ? 'read' : 'closed')} disabled={saving}>
                Cancel
              </Button>
              <Button key="save" size="lg" variant="primary" type="submit" form={formId} loading={saving}>
                {copy.save}
              </Button>
            </>
          )
        }
      >
        {reading ? (
          <div className="space-y-6">
            {renderRead(current)}
            <div className="space-y-1.5 text-sm text-smoke">
              {/* A toast would sit behind this sheet, so say it here as well. */}
              {justSaved ? (
                <p role="status">
                  <StatusDot label="Saved" tone="ok" />
                </p>
              ) : null}
              <p>{current.notion_page_id ? 'Synced with Notion' : 'Not in Notion yet. Sync comes later.'}</p>
            </div>
          </div>
        ) : (
          <>
            <form id={formId} noValidate onSubmit={(event) => void handleSubmit(event)} className="space-y-5">
              {renderFields({
                draft,
                errors,
                onChange: (patch) => setDraft((previous) => ({ ...previous, ...patch })),
              })}
              {saveFailure ? (
                <p
                  ref={failureRef}
                  role="alert"
                  className="rounded-xl border border-bad/25 bg-bad-soft px-4 py-3 text-sm text-bone"
                >
                  {copy.saveFailed} {saveFailure}
                </p>
              ) : null}
            </form>
            {current ? (
              <div className="mt-6 border-t border-line pt-2">
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  disabled={saving}
                  className="-ml-3 inline-flex h-12 items-center gap-2 rounded-xl px-3 text-base text-bad transition-colors hover:bg-bad-soft active:bg-bad-soft disabled:pointer-events-none disabled:opacity-50"
                >
                  <Trash2 aria-hidden className="size-4" />
                  {copy.remove}
                </button>
              </div>
            ) : null}
          </>
        )}
      </Sheet>

      <ConfirmDialog
        open={leavingTo !== null}
        title="Discard your changes?"
        body="What you wrote here won’t be saved."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        tone="danger"
        onConfirm={() => leavingTo && leave(leavingTo)}
        onCancel={() => setLeavingTo(null)}
      />

      <ConfirmDialog
        open={confirmingDelete}
        title={copy.confirmRemove}
        confirmLabel={copy.remove}
        tone="danger"
        busy={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => {
          setConfirmingDelete(false)
          setDeleteFailure(null)
        }}
        body={
          <>
            <p>It is removed from Jarvis’s memory. This can’t be undone.</p>
            {deleteFailure ? (
              <p role="alert" className="mt-3 text-bad">
                {copy.removeFailed} {deleteFailure}
              </p>
            ) : null}
          </>
        }
      />
    </>
  )
}
