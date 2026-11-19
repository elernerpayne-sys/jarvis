/**
 * What the lists already know. A shop or a call usually opens from a row that
 * is on screen, so its name and summary can show at once while the full
 * record loads.
 */
import { useQueryClient } from '@tanstack/react-query'

import type { CallSummary, ShopSummary } from '@/lib/types'
import { qk } from '@/services/hooks'

export function useListedShop(shopId: string): ShopSummary | undefined {
  const queryClient = useQueryClient()
  return queryClient.getQueryData<ShopSummary[]>(qk.shops)?.find((shop) => shop.id === shopId)
}

/** Looks through every loaded call list, whichever shop or filter it was for. */
export function useListedCall(callId: string | null): CallSummary | undefined {
  const queryClient = useQueryClient()
  if (callId === null) return undefined
  for (const [, calls] of queryClient.getQueriesData<CallSummary[]>({ queryKey: qk.allCalls })) {
    const match = calls?.find((call) => call.id === callId)
    if (match) return match
  }
  return undefined
}
