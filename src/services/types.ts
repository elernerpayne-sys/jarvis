/**
 * The one service layer.
 *
 * Every screen talks to `JarvisService` and nothing else. There are two
 * implementations:
 *   - services/demo  → sample data held in memory, with a small simulator
 *   - services/live  → Supabase (tables + realtime + edge functions)
 *
 * To put a different backend behind the app, implement this interface and
 * return it from services/index.ts.
 */
import type {
  Alert,
  Appointment,
  Approval,
  ApprovalDecision,
  ApprovalStatus,
  Brief,
  Call,
  CallFilter,
  CallSummary,
  ChangeEvent,
  ConnectionStatus,
  Decision,
  DecisionInput,
  HandbookEntry,
  HandbookEntryInput,
  NewTaskInput,
  RealtimeStatus,
  RealtimeTable,
  Settings,
  SettingsPatch,
  ShopSummary,
  Task,
  TaskEvent,
  VoiceSession,
} from '@/lib/types'

export interface AuthUser {
  id: string
  email: string | null
}

export interface AuthApi {
  /** The signed-in owner, or null. Resolves from local storage; no network. */
  getUser(): Promise<AuthUser | null>
  /** Fires on sign-in, sign-out and token refresh. Returns an unsubscribe. */
  onChange(callback: (user: AuthUser | null) => void): () => void
  signInWithPassword(email: string, password: string): Promise<void>
  /** Emails a one-time code. Never creates an account. */
  sendEmailCode(email: string): Promise<void>
  verifyEmailCode(email: string, code: string): Promise<void>
  signOut(): Promise<void>
}

/**
 * Every method rejects with a `ServiceError` (see services/errors.ts) whose
 * `message` is safe to show to the owner.
 */
export interface JarvisService {
  /** "demo" when no Supabase keys are set: sample data, no login. */
  readonly mode: 'demo' | 'live'
  readonly auth: AuthApi

  // Home
  getBrief(): Promise<Brief>
  /** Newest first. Defaults to every status. */
  listApprovals(options?: { status?: ApprovalStatus }): Promise<Approval[]>
  decideApproval(id: string, decision: ApprovalDecision): Promise<Approval>
  /** Newest first. */
  listAlerts(options?: { limit?: number }): Promise<Alert[]>
  markAlertRead(id: string): Promise<void>
  markAllAlertsRead(): Promise<void>

  // Receptionist
  listShops(): Promise<ShopSummary[]>
  /** Rejects with code "not_found" when the shop does not exist. */
  getShop(id: string): Promise<ShopSummary>
  /** Appointments from now on, soonest first. Cancelled ones are left out. */
  listUpcomingAppointments(shopId: string): Promise<Appointment[]>
  /** Newest first. `problems` keeps only missed and failed calls. */
  listCalls(shopId: string, options?: { filter?: CallFilter }): Promise<CallSummary[]>
  /** One call with its full transcript. Rejects with "not_found". */
  getCall(id: string): Promise<Call>

  // Code
  listAllowedRepos(): Promise<string[]>
  /** Newest first. */
  listTasks(): Promise<Task[]>
  /** Rejects with code "not_found" when the task does not exist. */
  getTask(id: string): Promise<Task>
  /** Oldest first, so it reads like a log. */
  listTaskEvents(taskId: string): Promise<TaskEvent[]>
  createTask(input: NewTaskInput): Promise<Task>
  cancelTask(id: string): Promise<Task>

  // Memory
  /** Most recently updated first. Search is done on the client. */
  listHandbookEntries(): Promise<HandbookEntry[]>
  saveHandbookEntry(input: HandbookEntryInput): Promise<HandbookEntry>
  deleteHandbookEntry(id: string): Promise<void>
  /** Most recent decision date first. */
  listDecisions(): Promise<Decision[]>
  saveDecision(input: DecisionInput): Promise<Decision>
  deleteDecision(id: string): Promise<void>

  // Settings
  getSettings(): Promise<Settings>
  updateSettings(patch: SettingsPatch): Promise<Settings>
  /** Always resolves with one entry per service, in SERVICE_KEYS order. */
  getConnections(): Promise<ConnectionStatus[]>

  // Voice
  /** A fresh signed URL for one conversation with the Jarvis voice agent. */
  getVoiceSession(): Promise<VoiceSession>

  // Realtime
  /**
   * Calls `onChange` for every insert, update and delete on the given tables.
   * Returns an unsubscribe function. Safe to call more than once.
   */
  subscribe(
    tables: readonly RealtimeTable[],
    onChange: (event: ChangeEvent) => void,
    onStatus?: (status: RealtimeStatus) => void,
  ): () => void
}
