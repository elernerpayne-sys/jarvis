import { useEffect, useId, useRef } from 'react'
import type { MouseEvent, ReactNode, SyntheticEvent } from 'react'
import { X } from 'lucide-react'

import { cn } from '@/lib/cn'
import { Button, IconButton } from '@/components/ui/Button'

export interface SheetProps {
  open: boolean
  /** Called on Escape, backdrop press and the close button. */
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  /** Pinned under the scrolling content: the sheet's actions. */
  footer?: ReactNode
  /** Blocks Escape / backdrop close while something is saving. */
  busy?: boolean
}

/**
 * A modal panel: slides up from the bottom on a phone, sits centered on a
 * desktop. Built on the native `<dialog>`, so focus is trapped and returned
 * for free. Content is only mounted while open, so forms reset on reopen.
 */
export function Sheet({ open, onClose, title, description, children, footer, busy = false }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  // Leave the page behind the sheet still while it is open.
  useEffect(() => {
    if (!open) return
    const previous = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.documentElement.style.overflow = previous
    }
  }, [open])

  function handleCancel(event: SyntheticEvent<HTMLDialogElement>) {
    // Keep the dialog under React's control: we close it by flipping `open`.
    event.preventDefault()
    if (!busy) onClose()
  }

  function handleBackdrop(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === ref.current && !busy) onClose()
  }

  // Some browsers let a second Escape close the dialog on their own. If that
  // happens while we still think it is open, catch up.
  function handleNativeClose() {
    if (open) onClose()
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={handleCancel}
      onClose={handleNativeClose}
      onClick={handleBackdrop}
      className={cn(
        'm-0 mt-auto max-h-[92dvh] w-full max-w-none flex-col overflow-hidden p-0 text-bone',
        'rounded-t-2xl border border-b-0 border-line bg-raised open:flex',
        'backdrop:bg-black/65',
        'sm:m-auto sm:max-h-[86dvh] sm:w-[min(34rem,calc(100vw-3rem))] sm:rounded-2xl sm:border-b',
        'animate-sheet-in',
      )}
    >
      {open ? (
        <>
          <header className="flex items-start gap-3 px-5 pt-5">
            <div className="min-w-0 flex-1 pt-1.5">
              <h2 id={titleId} className="font-voice text-xl text-bone">
                {title}
              </h2>
              {description ? (
                <p id={descriptionId} className="mt-1 text-sm text-ash">
                  {description}
                </p>
              ) : null}
            </div>
            <IconButton label="Close" onClick={onClose} disabled={busy} className="-mr-2 -mt-1">
              <X aria-hidden className="size-5" />
            </IconButton>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">{children}</div>
          {footer ? (
            <footer className="flex gap-3 border-t border-line px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 [&>*]:flex-1">
              {footer}
            </footer>
          ) : (
            <div className="pb-[env(safe-area-inset-bottom)]" />
          )}
        </>
      ) : null}
    </dialog>
  )
}

export interface ConfirmDialogProps {
  open: boolean
  title: string
  /** What will happen, in one or two sentences. */
  body?: ReactNode
  /** The verb on the confirming button, e.g. "Approve", "Cancel task". */
  confirmLabel: string
  /** The way out. Defaults to "Go back". */
  cancelLabel?: string
  /** `danger` styles the confirming button for destructive actions. */
  tone?: 'default' | 'danger'
  /** True while the confirmed action is in flight. */
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** The confirm step before anything that can't be undone. */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Go back',
  tone = 'default',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Sheet
      open={open}
      onClose={onCancel}
      title={title}
      busy={busy}
      footer={
        <>
          <Button size="lg" variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button size="lg" variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {body ? <div className="text-base text-ash">{body}</div> : null}
    </Sheet>
  )
}
