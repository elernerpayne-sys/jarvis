/**
 * Data hooks. Screens use these instead of calling the service directly, so
 * loading, error and refresh behaviour is the same everywhere and realtime
 * updates (see app/RealtimeBridge.tsx) only need to invalidate a query key.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'

import type {
  ApprovalDecision,
  CallFilter,
  DecisionInput,
  HandbookEntryInput,
  NewTaskInput,
  SettingsPatch,
  Task,
} from '@/lib/types'
import { isNotFound } from '@/services/errors'
import { api } from '@/services'

export const qk = {
  brief: ['brief'] as const,
  approvals: ['approvals'] as const,
  pendingApprovals: ['approvals', 'pending'] as const,
  alerts: ['alerts'] as const,
  shops: ['shops'] as const,
  shop: (id: string) => ['shops', id] as const,
  appointments: (shopId: string) => ['appointments', shopId] as const,
  allAppointments: ['appointments'] as const,
  calls: (shopId: string, filter: CallFilter) => ['calls', shopId, filter] as const,
  allCalls: ['calls'] as const,
  call: (id: string) => ['call', id] as const,
  repos: ['repos'] as const,
  tasks: ['tasks'] as const,
  task: (id: string) => ['tasks', id] as const,
  taskEvents: (taskId: string) => ['task-events', taskId] as const,
  handbook: ['handbook'] as const,
  decisions: ['decisions'] as const,
  settings: ['settings'] as const,
  connections: ['connections'] as const,
}

/** Don't retry a "not found": it will not appear on the second try. */
function retryUnlessNotFound(failureCount: number, error: unknown): boolean {
  return !isNotFound(error) && failureCount < 1
}

// ── Home ───────────────────────────────────────────────────────────────────

export function useBrief() {
  return useQuery({
    queryKey: qk.brief,
    queryFn: () => api.getBrief(),
    // Counts drift as the day goes on even without a realtime event.
    refetchInterval: 60_000,
  })
}

export function usePendingApprovals() {
  return useQuery({
    queryKey: qk.pendingApprovals,
    queryFn: () => api.listApprovals({ status: 'pending' }),
  })
}

export function useDecideApproval() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; decision: ApprovalDecision }) =>
      api.decideApproval(input.id, input.decision),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.approvals })
      void queryClient.invalidateQueries({ queryKey: qk.tasks })
    },
  })
}

export function useAlerts() {
  return useQuery({
    queryKey: qk.alerts,
    queryFn: () => api.listAlerts({ limit: 50 }),
  })
}

export function useMarkAlertRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.markAlertRead(id),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: qk.alerts }),
  })
}

export function useMarkAllAlertsRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.markAllAlertsRead(),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: qk.alerts }),
  })
}

// ── Receptionist ───────────────────────────────────────────────────────────

export function useShops() {
  return useQuery({ queryKey: qk.shops, queryFn: () => api.listShops() })
}

export function useShop(id: string) {
  return useQuery({
    queryKey: qk.shop(id),
    queryFn: () => api.getShop(id),
    retry: retryUnlessNotFound,
  })
}

export function useUpcomingAppointments(shopId: string) {
  return useQuery({
    queryKey: qk.appointments(shopId),
    queryFn: () => api.listUpcomingAppointments(shopId),
  })
}

export function useCalls(shopId: string, filter: CallFilter) {
  return useQuery({
    queryKey: qk.calls(shopId, filter),
    queryFn: () => api.listCalls(shopId, { filter }),
  })
}

/** Pass null to keep the query idle (for example while no call is selected). */
export function useCall(id: string | null) {
  return useQuery({
    queryKey: qk.call(id ?? 'none'),
    queryFn: () => api.getCall(id as string),
    enabled: id !== null,
    retry: retryUnlessNotFound,
  })
}

// ── Code ───────────────────────────────────────────────────────────────────

export function useAllowedRepos() {
  return useQuery({ queryKey: qk.repos, queryFn: () => api.listAllowedRepos() })
}

export function useTasks() {
  return useQuery({ queryKey: qk.tasks, queryFn: () => api.listTasks() })
}

export function useTask(id: string) {
  return useQuery({
    queryKey: qk.task(id),
    queryFn: () => api.getTask(id),
    retry: retryUnlessNotFound,
  })
}

export function useTaskEvents(taskId: string) {
  return useQuery({
    queryKey: qk.taskEvents(taskId),
    queryFn: () => api.listTaskEvents(taskId),
  })
}

function rememberTask(queryClient: QueryClient, task: Task) {
  queryClient.setQueryData(qk.task(task.id), task)
  void queryClient.invalidateQueries({ queryKey: qk.tasks })
  void queryClient.invalidateQueries({ queryKey: qk.taskEvents(task.id) })
}

export function useCreateTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: NewTaskInput) => api.createTask(input),
    onSuccess: (task) => rememberTask(queryClient, task),
  })
}

export function useCancelTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.cancelTask(id),
    onSuccess: (task) => {
      rememberTask(queryClient, task)
      void queryClient.invalidateQueries({ queryKey: qk.approvals })
    },
  })
}

// ── Memory ─────────────────────────────────────────────────────────────────

export function useHandbook() {
  return useQuery({ queryKey: qk.handbook, queryFn: () => api.listHandbookEntries() })
}

export function useSaveHandbookEntry() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: HandbookEntryInput) => api.saveHandbookEntry(input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.handbook }),
  })
}

export function useDeleteHandbookEntry() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteHandbookEntry(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.handbook }),
  })
}

export function useDecisions() {
  return useQuery({ queryKey: qk.decisions, queryFn: () => api.listDecisions() })
}

export function useSaveDecision() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: DecisionInput) => api.saveDecision(input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.decisions }),
  })
}

export function useDeleteDecision() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteDecision(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.decisions }),
  })
}

// ── Settings ───────────────────────────────────────────────────────────────

export function useSettings() {
  return useQuery({ queryKey: qk.settings, queryFn: () => api.getSettings() })
}

export function useUpdateSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: SettingsPatch) => api.updateSettings(patch),
    onSuccess: (settings) => {
      queryClient.setQueryData(qk.settings, settings)
      void queryClient.invalidateQueries({ queryKey: qk.repos })
    },
  })
}

export function useConnections() {
  return useQuery({
    queryKey: qk.connections,
    queryFn: () => api.getConnections(),
    // A status check hits four services; don't repeat it on every focus.
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
}
