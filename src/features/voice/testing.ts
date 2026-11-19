/**
 * Helpers shared by this folder's tests. Nothing in the app imports this.
 */
import { vi } from 'vitest'

import type { Approval, Brief, ShopSummary, Task } from '@/lib/types'
import type { TranscriptLine, VoiceController } from '@/features/voice/types'

/** A controller whose actions are spies, in the idle state unless told otherwise. */
export function fakeController(overrides: Partial<VoiceController> = {}): VoiceController {
  return {
    status: 'idle',
    mode: 'listening',
    channel: null,
    transcript: [],
    error: null,
    muted: false,
    startVoice: vi.fn(),
    stop: vi.fn(),
    sendText: vi.fn(),
    retry: vi.fn(),
    typing: vi.fn(),
    setMuted: vi.fn(),
    clear: vi.fn(),
    getVolume: vi.fn(() => 0),
    ...overrides,
  }
}

export function transcriptOf(...turns: Array<[TranscriptLine['role'], string]>): TranscriptLine[] {
  return turns.map(([role, text], index) => ({ id: `t${index}`, role, text, at: index }))
}

const NOW = '2026-11-19T15:00:00.000Z'

export const sampleBrief: Brief = {
  date: '2026-11-19',
  calls_answered: 14,
  bookings_made: 9,
  missed_calls: 2,
  tasks_finished: 3,
}

export const sampleApprovals: Approval[] = [
  {
    id: 'ap-1',
    kind: 'code',
    title: 'Push the booking fix and open a pull request?',
    detail: null,
    task_id: 'task-1',
    shop_id: null,
    status: 'pending',
    requested_at: NOW,
    decided_at: null,
    expires_at: null,
    created_at: NOW,
  },
  {
    id: 'ap-2',
    kind: 'spend',
    title: 'Renew the Fade Factory phone line for $18?',
    detail: null,
    task_id: null,
    shop_id: 'shop-1',
    status: 'pending',
    requested_at: NOW,
    decided_at: null,
    expires_at: null,
    created_at: NOW,
  },
]

function task(id: string, title: string, status: Task['status']): Task {
  return {
    id,
    external_id: null,
    title,
    repo: 'monserrat/booking-site',
    instructions: title,
    status,
    branch: null,
    result_summary: null,
    pr_url: null,
    error: null,
    created_at: NOW,
    updated_at: NOW,
    started_at: null,
    finished_at: null,
  }
}

export const sampleTasks: Task[] = [
  task('task-3', 'Add a waitlist page', 'done'),
  task('task-2', 'Fix the double-booking bug', 'running'),
]

function shop(id: string, name: string, counts: [calls: number, bookings: number, missed: number]): ShopSummary {
  return {
    id,
    name,
    phone: '+15125550142',
    address: '12 Main St',
    timezone: 'America/Chicago',
    status: 'active',
    created_at: NOW,
    calls_today: counts[0],
    bookings_today: counts[1],
    missed_today: counts[2],
    next_appointment_at: null,
  }
}

export const sampleShops: ShopSummary[] = [
  shop('shop-1', 'Fade Factory', [9, 6, 2]),
  shop('shop-2', 'Northside Barbers', [5, 3, 0]),
]

/** A stand-in for the service layer that answers with the samples above. */
export function sampleSource() {
  return {
    getBrief: vi.fn(async () => sampleBrief),
    listApprovals: vi.fn(async () => sampleApprovals),
    listTasks: vi.fn(async () => sampleTasks),
    listShops: vi.fn(async () => sampleShops),
  }
}
