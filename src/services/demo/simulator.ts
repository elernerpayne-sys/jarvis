/**
 * Makes the demo feel alive: tasks write their progress logs line by line,
 * ask for approval, and finish; now and then a new call comes in at one of
 * the shops. Every change goes through the store, so subscribers see it the
 * way realtime delivers it in the live app.
 *
 * All timing goes through `timers`, so clearing them stops everything.
 */
import { titleFromInstructions } from '@/lib/format'
import type { Approval, Task, TaskEventKind } from '@/lib/types'

import { approvalAlert, callProblemAlert, raiseAlert, taskDoneAlert } from './alerts'
import type { CallWriter } from './calls'
import type { Random } from './random'
import type { Schedule } from './schedule'
import type { ScriptLine, TaskPlan } from './seed/code'
import { SHOP_PROFILES } from './seed/shops'
import { toCallSummary } from './store'
import type { Store } from './store'
import type { Timers } from './timers'
import { SECOND, iso } from './time'

/** Gaps between log lines, in milliseconds. */
const SEEDED_GAP: readonly [number, number] = [4 * SECOND, 7 * SECOND]
const OWNER_GAP: readonly [number, number] = [2 * SECOND, 3 * SECOND]
/** A task the owner creates is picked up after about this long. */
const PICK_UP_MS = 2 * SECOND
/** How often a new call comes in. */
const CALL_GAP: readonly [number, number] = [60 * SECOND, 90 * SECOND]

export interface Simulator {
  /** Carries on with the tasks already in flight and starts taking calls. */
  start(): void
  /** The owner created a task: pick it up and run it. */
  taskCreated(taskId: string): void
  /** The owner decided an approval; the store already shows the decision. */
  approvalDecided(approval: Approval): void
  /** The owner cancelled a task; stop its run. */
  taskCancelled(taskId: string): void
}

export interface SimulatorDeps {
  store: Store
  timers: Timers
  now: () => Date
  rng: Random
  writer: CallWriter | null
  schedule: Schedule
  plans: Map<string, TaskPlan>
}

/** "Fix the Saturday hours" → "fix-the-saturday-hours", cut to fit a branch name. */
function slug(text: string): string {
  const words = text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
  let result = ''
  for (const word of words) {
    const next = result ? `${result}-${word}` : word
    if (next.length > 36) break
    result = next
  }
  return result || 'change'
}

/** A believable run for a task the owner just typed in. */
function ownerPlan(task: Task, prNumber: number, rng: Random): TaskPlan {
  const branch = `jarvis/${slug(titleFromInstructions(task.instructions, 60))}`
  const passed = rng.int(24, 140)
  const files = rng.int(2, 6)
  const line = (kind: TaskEventKind, message: string): ScriptLine => ({ kind, message })
  return {
    steps: [
      line('log', `Cloned ${task.repo}`),
      line('command', '$ npm ci'),
      line('log', `Read the instructions and found the code to change in ${task.repo}`),
      line('command', `$ git checkout -b ${branch}`),
      line('log', `Made the change across ${files} files`),
      line('command', '$ npm test'),
      line('log', `${passed} passed`),
      line('command', `$ git push origin ${branch}`),
      line('log', `Opened pull request #${prNumber} on ${task.repo}`),
    ],
    afterApproval: [],
    result: {
      branch,
      result_summary: `Made the change on ${branch} across ${files} files and opened pull request #${prNumber} in ${task.repo}. All ${passed} tests pass.`,
      pr_url: `https://github.com/${task.repo}/pull/${prNumber}`,
    },
  }
}

export function createSimulator(deps: SimulatorDeps): Simulator {
  const { store, timers, now, rng, writer, schedule, plans } = deps
  /** The pending step of each task's run, so it can be stopped. */
  const runs = new Map<string, () => void>()
  let nextPr = 150

  const between = ([min, max]: readonly [number, number]) => rng.int(min, max)

  function stop(taskId: string): void {
    runs.get(taskId)?.()
    runs.delete(taskId)
  }

  function later(taskId: string, ms: number, step: () => void): void {
    stop(taskId)
    const cancel = timers.after(ms, () => {
      runs.delete(taskId)
      step()
    })
    runs.set(taskId, cancel)
  }

  function isRunning(taskId: string): boolean {
    return store.find('tasks', taskId)?.status === 'running'
  }

  function log(taskId: string, kind: TaskEventKind, message: string): void {
    const at = iso(now())
    store.insert('task_events', { id: store.ids.next('event'), task_id: taskId, kind, message, created_at: at })
  }

  function planFor(taskId: string): TaskPlan | undefined {
    const existing = plans.get(taskId)
    if (existing) return existing
    const task = store.find('tasks', taskId)
    if (!task) return undefined
    const plan = ownerPlan(task, nextPr++, rng)
    plans.set(taskId, plan)
    return plan
  }

  /** Writes `lines` one at a time while the task keeps running, then `done`. */
  function play(taskId: string, lines: readonly ScriptLine[], gap: readonly [number, number], done: () => void): void {
    let index = 0
    const step = () => {
      if (!isRunning(taskId)) return
      if (index >= lines.length) {
        done()
        return
      }
      const line = lines[index++]
      log(taskId, line.kind, line.message)
      store.update('tasks', taskId, { updated_at: iso(now()) })
      later(taskId, between(gap), step)
    }
    later(taskId, between(gap), step)
  }

  function askForApproval(taskId: string, plan: TaskPlan): void {
    if (!plan.approval) return finish(taskId, plan)
    const at = iso(now())
    const approval = store.insert('approvals', {
      id: store.ids.next('approval'),
      kind: 'code',
      title: plan.approval.title,
      detail: plan.approval.detail,
      task_id: taskId,
      shop_id: null,
      status: 'pending',
      requested_at: at,
      decided_at: null,
      expires_at: null,
      created_at: at,
    })
    store.update('tasks', taskId, { status: 'needs_approval', updated_at: at })
    log(taskId, 'status', 'Waiting for your approval')
    raiseAlert(store, approvalAlert(approval, plan.approval.headline), now())
  }

  function finish(taskId: string, plan: TaskPlan): void {
    const at = iso(now())
    log(taskId, 'status', 'Done')
    const task = store.update('tasks', taskId, {
      status: 'done',
      ...plan.result,
      error: null,
      updated_at: at,
      finished_at: at,
    })
    plans.delete(taskId)
    if (task) raiseAlert(store, taskDoneAlert(task), now())
  }

  /** Runs a plan from the top: its steps, then approval or done. */
  function runPlan(taskId: string, gap: readonly [number, number]): void {
    const plan = planFor(taskId)
    if (!plan) return
    play(taskId, plan.steps, gap, () => askForApproval(taskId, plan))
  }

  function pickUp(taskId: string): void {
    const task = store.find('tasks', taskId)
    if (!task || task.status !== 'queued') return
    const at = iso(now())
    log(taskId, 'log', 'Sent to Jarvis.')
    log(taskId, 'status', 'Started')
    store.update('tasks', taskId, {
      status: 'running',
      external_id: `jv_${taskId.replace('task-', '')}`,
      started_at: at,
      updated_at: at,
    })
    runPlan(taskId, OWNER_GAP)
  }

  // ── Calls ──────────────────────────────────────────────────────────────
  function takeCall(): void {
    if (!writer) return
    const active = SHOP_PROFILES.filter((profile) =>
      store.data.shops.some((shop) => shop.id === profile.id && shop.status === 'active'),
    )
    if (active.length === 0) return
    const profile = rng.pick(active)
    const outcome = rng.weighted({ booked: 55, answered: 33, missed: 12 })
    let written
    try {
      written = writer.write({ profile, outcome, endedAt: now() }, schedule)
    } catch {
      return // The shop is booked solid; no call this time.
    }
    store.insert('calls', written.call)
    for (const appointment of written.appointments) store.insert('appointments', appointment)
    if (outcome === 'missed') {
      raiseAlert(store, callProblemAlert(toCallSummary(written.call), profile.name), now())
    }
  }

  function scheduleCalls(): void {
    timers.after(between(CALL_GAP), () => {
      takeCall()
      scheduleCalls()
    })
  }

  return {
    start() {
      for (const task of store.data.tasks) {
        if (task.status === 'running' && plans.has(task.id)) runPlan(task.id, SEEDED_GAP)
      }
      if (writer) scheduleCalls()
    },

    taskCreated(taskId) {
      later(taskId, PICK_UP_MS, () => pickUp(taskId))
    },

    approvalDecided(approval) {
      if (approval.status !== 'approved' || !approval.task_id) return
      const taskId = approval.task_id
      if (!isRunning(taskId)) return
      const plan = planFor(taskId)
      if (!plan) return
      play(taskId, plan.afterApproval, OWNER_GAP, () => finish(taskId, plan))
    },

    taskCancelled(taskId) {
      stop(taskId)
      plans.delete(taskId)
    },
  }
}
