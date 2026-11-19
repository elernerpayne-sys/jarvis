import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'
import type { Tone } from '@/lib/status'
import { Dot } from '@/components/ui/StatusDot'

export interface ToastOptions {
  tone?: Tone
  /** A single follow-up, e.g. { label: 'View', onPress: () => navigate(…) }. */
  action?: { label: string; onPress: () => void }
  /** Milliseconds on screen. Defaults to 4000. */
  duration?: number
}

interface ToastItem extends ToastOptions {
  id: number
  message: string
}

type ShowToast = (message: string, options?: ToastOptions) => void

const ToastContext = createContext<ShowToast | null>(null)

/** `const toast = useToast(); toast('Approved', { tone: 'ok' })` */
export function useToast(): ShowToast {
  const show = useContext(ToastContext)
  if (!show) throw new Error('useToast must be used inside <ToastProvider>.')
  return show
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(1)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id)
    if (timer) clearTimeout(timer)
    timers.current.delete(id)
    setItems((current) => current.filter((item) => item.id !== id))
  }, [])

  const show = useCallback<ShowToast>(
    (message, options) => {
      const id = nextId.current++
      // Keep at most three on screen; the oldest gives way.
      setItems((current) => [...current.slice(-2), { id, message, ...options }])
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), options?.duration ?? 4000),
      )
    },
    [dismiss],
  )

  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const timer of pending.values()) clearTimeout(timer)
      pending.clear()
    }
  }, [])

  const value = useMemo(() => show, [show])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className={cn(
          'pointer-events-none fixed inset-x-0 z-50 flex flex-col items-center gap-2 px-4',
          'bottom-[calc(5.25rem+env(safe-area-inset-bottom))] lg:bottom-6 lg:left-60',
        )}
      >
        {items.map((item) => (
          <div
            key={item.id}
            className="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-xl border border-line-strong bg-raised-3 py-2 pl-4 pr-2 text-sm text-bone shadow-lg shadow-black/40"
          >
            <Dot tone={item.tone ?? 'neutral'} />
            <span className="min-w-0 flex-1 py-1.5">{item.message}</span>
            {item.action ? (
              <button
                type="button"
                className="h-9 shrink-0 rounded-lg px-3 font-medium text-amber hover:bg-raised-2"
                onClick={() => {
                  item.action?.onPress()
                  dismiss(item.id)
                }}
              >
                {item.action.label}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
