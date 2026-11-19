import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'

import { alertLink } from '@/lib/links'
import { ALERT_TONE } from '@/lib/status'
import { REALTIME_TABLES } from '@/lib/types'
import type { ChangeEvent, RealtimeStatus, TaskEvent } from '@/lib/types'
import { api } from '@/services'
import { qk } from '@/services/hooks'
import { useToast } from '@/components/ui/Toast'

const RealtimeContext = createContext<RealtimeStatus>('connecting')

/** "live" while changes are streaming in; "offline" when the connection dropped. */
export function useRealtimeStatus(): RealtimeStatus {
  return useContext(RealtimeContext)
}

/**
 * Listens for changes to tasks, approvals, alerts, calls and appointments and
 * keeps every screen current by refreshing the queries they touch. New alerts
 * also surface as a toast.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const [status, setStatus] = useState<RealtimeStatus>('connecting')

  // The subscription outlives renders; read the latest callbacks through refs.
  const toastRef = useRef(toast)
  const navigateRef = useRef(navigate)
  useEffect(() => {
    toastRef.current = toast
    navigateRef.current = navigate
  })

  useEffect(() => {
    const refresh = (queryKey: readonly unknown[]) => void queryClient.invalidateQueries({ queryKey })
    let wasOffline = false

    function handleChange(event: ChangeEvent) {
      switch (event.table) {
        case 'tasks':
          if (event.row) queryClient.setQueryData(qk.task(event.row.id), event.row)
          refresh(qk.tasks)
          refresh(qk.brief)
          break
        case 'task_events': {
          const row = event.row
          if (event.type === 'INSERT' && row) {
            // Append in place so a running log scrolls smoothly.
            queryClient.setQueryData<TaskEvent[]>(qk.taskEvents(row.task_id), (current) =>
              current && !current.some((item) => item.id === row.id) ? [...current, row] : current,
            )
          } else {
            refresh(['task-events'])
          }
          break
        }
        case 'approvals':
          refresh(qk.approvals)
          break
        case 'alerts': {
          refresh(qk.alerts)
          const row = event.row
          if (event.type === 'INSERT' && row) {
            toastRef.current(row.title, {
              tone: ALERT_TONE[row.type],
              action: { label: 'View', onPress: () => navigateRef.current(alertLink(row)) },
            })
          }
          break
        }
        case 'calls':
          refresh(qk.allCalls)
          refresh(qk.call(event.id))
          refresh(qk.shops)
          refresh(qk.brief)
          break
        case 'appointments':
          refresh(qk.allAppointments)
          refresh(qk.shops)
          break
      }
    }

    function handleStatus(next: RealtimeStatus) {
      setStatus(next)
      if (next === 'offline') wasOffline = true
      if (next === 'live' && wasOffline) {
        // We may have missed changes while disconnected: reload everything.
        wasOffline = false
        void queryClient.invalidateQueries()
      }
    }

    return api.subscribe(REALTIME_TABLES, handleChange, handleStatus)
  }, [queryClient])

  return <RealtimeContext.Provider value={status}>{children}</RealtimeContext.Provider>
}
