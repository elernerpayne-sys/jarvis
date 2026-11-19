import type { HTMLAttributes } from 'react'

import { cn } from '@/lib/cn'

/**
 * A raised surface. Reserved for things you act on (an approval, a form).
 * Plain lists belong in `<List>`, not in cards.
 */
export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-2xl border border-line bg-raised p-5', className)} {...rest} />
  )
}
