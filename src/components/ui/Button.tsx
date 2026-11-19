import type { ButtonHTMLAttributes, ReactNode } from 'react'

import { cn } from '@/lib/cn'
import { Spinner } from '@/components/ui/Spinner'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-amber text-amber-ink hover:bg-amber/90 active:bg-amber/80',
  secondary: 'border border-line bg-raised-2 text-bone hover:bg-raised-3 active:bg-raised-3',
  ghost: 'text-ash hover:bg-raised-2 hover:text-bone active:bg-raised-2',
  danger: 'border border-bad/25 bg-bad-soft text-bad hover:bg-bad/20 active:bg-bad/25',
}

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-11 px-3.5 text-sm',
  md: 'h-12 px-4 text-base',
  lg: 'h-13 px-5 text-base',
}

/**
 * The classes behind `<Button>`, for when the element has to be something
 * else, e.g. `<Link className={buttonClass({ variant: 'primary' })}>`.
 */
export function buttonClass(options: {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
} = {}): string {
  const { variant = 'secondary', size = 'md', fullWidth = false } = options
  return cn(
    'inline-flex shrink-0 select-none items-center justify-center gap-2 rounded-xl font-medium',
    'transition-colors disabled:pointer-events-none disabled:opacity-50',
    VARIANT[variant],
    SIZE[size],
    fullWidth && 'w-full',
  )
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
  /** Shows a spinner and blocks presses while something is in flight. */
  loading?: boolean
  /** Shown before the label. Replaced by the spinner while loading. */
  icon?: ReactNode
}

export function Button({
  variant,
  size,
  fullWidth,
  loading = false,
  icon,
  children,
  className,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonClass({ variant, size, fullWidth }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner className="size-4" /> : icon}
      {children}
    </button>
  )
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Read by screen readers; also the tooltip. */
  label: string
  children: ReactNode
}

/** A 48px square button holding just an icon. */
export function IconButton({ label, children, className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-12 shrink-0 items-center justify-center rounded-xl text-ash transition-colors',
        'hover:bg-raised-2 hover:text-bone active:bg-raised-2 disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}
