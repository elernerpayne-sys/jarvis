import type { Alert } from '@/lib/types'

/** Where each screen lives. Build links with these, never by hand. */
export const routes = {
  home: '/',
  receptionist: '/receptionist',
  shop: (shopId: string) => `/receptionist/${shopId}`,
  /** Opens the shop with one call's transcript showing. */
  call: (shopId: string, callId: string) => `/receptionist/${shopId}?call=${callId}`,
  code: '/code',
  newTask: '/code/new',
  task: (taskId: string) => `/code/${taskId}`,
  memory: '/memory',
  settings: '/settings',
} as const

/** The screen an alert is about. */
export function alertLink(alert: Pick<Alert, 'task_id' | 'call_id' | 'shop_id'>): string {
  if (alert.task_id) return routes.task(alert.task_id)
  if (alert.shop_id && alert.call_id) return routes.call(alert.shop_id, alert.call_id)
  if (alert.shop_id) return routes.shop(alert.shop_id)
  return routes.home
}
