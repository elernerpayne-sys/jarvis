/**
 * Hands new coding tasks to the task runner (docs/runner.md).
 *
 * - No runner configured: the task stays queued, with one log line saying so.
 *   Once TASK_RUNNER_URL and TASK_RUNNER_KEY are set and the server restarts,
 *   waiting tasks are sent.
 * - Runner said no (4xx): the task fails with the reason.
 * - Runner unreachable or 5xx: the task stays queued and is retried every minute.
 */
import type { Config } from './config.ts'
import { runnerProblem, runnerReason, taskRunner } from './services.ts'
import type { Store } from './store.ts'
import { isRecord, logError, parseJson } from './util.ts'

export interface Dispatcher {
  dispatchSoon(taskId: string): void
  /** Sends every queued task the runner hasn't accepted yet. */
  sweep(): Promise<void>
  stop(): void
}

export function createDispatcher(store: Store, config: Config): Dispatcher {
  const inFlight = new Set<string>()

  async function dispatch(taskId: string): Promise<void> {
    if (inFlight.has(taskId)) return
    inFlight.add(taskId)
    try {
      const task = store.getTask(taskId)
      if (!task || task.status !== 'queued') return
      const runner = taskRunner(config)
      if (!runner) {
        store.recordDispatch(taskId, { kind: 'not_configured' })
        return
      }
      const outcome = await runner.submit({ task_id: task.id, title: task.title, repo: task.repo, instructions: task.instructions })
      if (outcome.kind === 'response' && outcome.ok) {
        const body = parseJson(outcome.text)
        const externalId = isRecord(body) && typeof body.external_id === 'string' && body.external_id.trim() !== '' ? body.external_id.trim().slice(0, 200) : null
        store.recordDispatch(taskId, { kind: 'accepted', externalId })
        return
      }
      if (outcome.kind === 'response' && outcome.status >= 400 && outcome.status < 500 && outcome.status !== 408 && outcome.status !== 429) {
        const reason = runnerReason(outcome)
        store.recordDispatch(taskId, {
          kind: 'rejected',
          detail: reason ? `The task runner turned this task down: ${reason}` : `The task runner turned this task down (HTTP ${outcome.status}).`,
        })
        return
      }
      const problem = runnerProblem(outcome)
      store.recordDispatch(taskId, { kind: 'unreachable', detail: `Couldn’t send this task: ${problem}` })
    } catch (error) {
      logError('tasks: dispatch failed', error)
    } finally {
      inFlight.delete(taskId)
    }
  }

  async function sweep() {
    if (!taskRunner(config)) return
    for (const task of store.undispatchedTasks()) await dispatch(task.id)
  }

  const timer = setInterval(() => void sweep(), 60_000)
  timer.unref()

  return {
    dispatchSoon(taskId) {
      setImmediate(() => void dispatch(taskId))
    },
    sweep,
    stop: () => clearInterval(timer),
  }
}
