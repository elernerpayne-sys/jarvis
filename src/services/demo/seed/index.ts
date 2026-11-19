/**
 * Builds the whole sample database for one moment in time. The same seed and
 * the same "now" always give the same data.
 */
import { createCallWriter } from '../calls'
import type { CallWriter } from '../calls'
import type { Ids } from '../ids'
import { createRandom } from '../random'
import type { Random } from '../random'
import type { DemoData } from '../store'
import { seedCode } from './code'
import type { CodeSeed, TaskPlan } from './code'
import { seedHome } from './home'
import { seedMemory } from './memory'
import { createCast } from './people'
import type { Cast } from './people'
import { seedReceptionist } from './receptionist'
import { seedSettings } from './settings'
import { SHOP_PROFILES } from './shops'

export { connectionStatuses } from './settings'
export type { TaskPlan } from './code'

export interface Seed {
  data: DemoData
  /** What the simulator needs to keep writing calls in the same voice. */
  rng: Random
  cast: Cast
  writer: CallWriter
  /** Plans for the tasks still in flight, by task id. */
  plans: Map<string, TaskPlan>
  code: CodeSeed
}

export function buildSeed(options: { now: Date; seed: number; ids: Ids }): Seed {
  const { now, ids } = options
  const rng = createRandom(options.seed)
  // Busier shops have more regulars.
  const shares = Object.fromEntries(SHOP_PROFILES.map((p) => [p.id, p.callsPerDay[1]]))
  const cast = createCast(rng, shares)
  const writer = createCallWriter({ rng, ids, cast })

  const receptionist = seedReceptionist({ now, rng, ids, cast, writer })
  const settings = seedSettings(now)
  const code = seedCode(now, ids)
  const memory = seedMemory(now, ids)
  const home = seedHome({
    now,
    ids,
    settings,
    shops: receptionist.shops,
    calls: receptionist.calls,
    tasks: code.tasks,
    code,
    lateCancellation: receptionist.lateCancellation,
  })

  return {
    data: {
      shops: receptionist.shops,
      calls: receptionist.calls,
      appointments: receptionist.appointments,
      tasks: code.tasks,
      task_events: code.task_events,
      approvals: home.approvals,
      alerts: home.alerts,
      handbook_entries: memory.handbook_entries,
      decisions: memory.decisions,
      settings,
    },
    rng,
    cast,
    writer,
    plans: code.plans,
    code,
  }
}

/** Every list empty; settings still load. For `?demo=empty`. */
export function emptyData(now: Date): DemoData {
  return {
    shops: [],
    calls: [],
    appointments: [],
    tasks: [],
    task_events: [],
    approvals: [],
    alerts: [],
    handbook_entries: [],
    decisions: [],
    settings: seedSettings(now),
  }
}

/** Every shop's line, for the Twilio connection detail. */
export function shopLines(data: DemoData): string[] {
  return data.shops.map((shop) => shop.phone)
}
