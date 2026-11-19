/**
 * The coding side of the week: tasks Jarvis ran in the owner's repos, each
 * with its progress log, and the approvals that came with them. Times are
 * minutes before "now", so the log always reads as recent.
 *
 * Two tasks are still moving when the app opens. The running one carries on
 * from its `plan` (see simulator.ts), and the one waiting for approval
 * finishes from its plan once the owner approves.
 */
import type { Approval, Task, TaskEvent, TaskEventKind } from '@/lib/types'

import type { Ids } from '../ids'
import { addMinutes, addSeconds, iso } from '../time'

export const ALLOWED_REPOS = [
  'jarvis-ops/booking-site',
  'jarvis-ops/receptionist-agent',
  'jarvis-ops/shop-dashboard',
  'jarvis-ops/jarvis-backend',
] as const

export interface ScriptLine {
  kind: TaskEventKind
  message: string
}

/** What a task still has to do. The simulator plays it one line at a time. */
export interface TaskPlan {
  /** Lines before it asks for approval, or before it finishes. */
  steps: ScriptLine[]
  /** Asked once `steps` are done. Leave out to finish straight away. */
  approval?: { title: string; detail: string; headline: string }
  /** Lines after the owner approves. */
  afterApproval: ScriptLine[]
  result: { branch: string; result_summary: string; pr_url: string }
}

export interface CodeSeed {
  tasks: Task[]
  task_events: TaskEvent[]
  approvals: Approval[]
  /** Plans for the tasks still in flight, by task id. */
  plans: Map<string, TaskPlan>
  /** The task that is running when the app opens. */
  runningTaskId: string
  /** The task waiting for the owner's approval, and that approval. */
  waitingTaskId: string
  waitingApprovalId: string
  /** The finished task from today, for its alert. */
  doneTodayTaskId: string
  failedTaskId: string
}

/** [kind, message, seconds after the task was created] */
type LogEntry = readonly [TaskEventKind, string, number]

interface TaskStory {
  repo: (typeof ALLOWED_REPOS)[number]
  title: string
  instructions: string
  status: Task['status']
  /** Minutes before now that the task was created. */
  createdMinutesAgo: number
  /** Seconds after creation that it started running; null if it never did. */
  startedAfter: number | null
  /** Seconds after creation that it finished; null if it has not. */
  finishedAfter: number | null
  branch?: string
  result_summary?: string
  pr_url?: string
  error?: string
  log: readonly LogEntry[]
}

const pr = (repo: string, number: number) => `https://github.com/${repo}/pull/${number}`

const RUNNING: TaskStory = {
  repo: 'jarvis-ops/receptionist-agent',
  title: 'Offer the waitlist when the time a caller wants is taken',
  instructions:
    'Offer the waitlist when the time a caller wants is taken\n\nRight now Jarvis just asks "anything else?" when a slot is gone. Offer to put them on the waitlist instead, save their number and the time they wanted, and text them if it opens up.',
  status: 'running',
  createdMinutesAgo: 8,
  startedAfter: 40,
  finishedAfter: null,
  branch: 'jarvis/waitlist-offer',
  log: [
    ['status', 'Queued', 0],
    ['log', 'Sent to Jarvis.', 4],
    ['status', 'Started', 40],
    ['log', 'Cloned jarvis-ops/receptionist-agent', 52],
    ['command', '$ npm ci', 58],
    ['log', 'Installed 412 packages', 104],
    ['log', 'Found the booking flow in src/flows/book.ts; open slots come from getOpenSlots()', 170],
    ['command', '$ git checkout -b jarvis/waitlist-offer', 205],
    ['log', 'Added an offerWaitlist step for when the slot comes back taken', 300],
  ],
}

const RUNNING_PLAN: TaskPlan = {
  steps: [
    { kind: 'log', message: 'Wrote the prompt: “That time’s taken. Want me to put you on the waitlist and text you if it opens up?”' },
    { kind: 'log', message: 'Saved waitlist requests with the caller’s number, the service and the time they wanted' },
    { kind: 'command', message: '$ npm test' },
    { kind: 'log', message: '63 passed, 2 failed' },
    { kind: 'error', message: '2 tests in book.test.ts still expect “anything else?” after a taken slot' },
    { kind: 'log', message: 'Updated both tests to expect the waitlist offer' },
    { kind: 'command', message: '$ npm test' },
    { kind: 'log', message: '65 passed' },
    { kind: 'command', message: '$ npm run lint' },
    { kind: 'log', message: 'No lint problems' },
  ],
  approval: {
    title: 'Push jarvis/waitlist-offer and open a pull request on jarvis-ops/receptionist-agent?',
    detail:
      'Jarvis now offers the waitlist when the time a caller asks for is taken, and texts them if it opens up. 4 files changed and all 65 tests pass. Nothing goes live until you merge.',
    headline: 'The waitlist change is ready to push',
  },
  afterApproval: [
    { kind: 'command', message: '$ git push origin jarvis/waitlist-offer' },
    { kind: 'log', message: 'Opened pull request #58 on jarvis-ops/receptionist-agent' },
  ],
  result: {
    branch: 'jarvis/waitlist-offer',
    result_summary:
      'When the time a caller asks for is taken, Jarvis now offers the waitlist, saves their number and the time they wanted, and texts them if it opens up. Two booking tests were updated to match.',
    pr_url: pr('jarvis-ops/receptionist-agent', 58),
  },
}

const WAITING: TaskStory = {
  repo: 'jarvis-ops/booking-site',
  title: 'Show each barber’s next free slot on the booking page',
  instructions:
    'Show each barber’s next free slot on the booking page\n\nUnder each barber’s photo, show the next time they’re free ("Next free: today 3:15 PM") so people stop clicking through empty days.',
  status: 'needs_approval',
  createdMinutesAgo: 55,
  startedAfter: 30,
  finishedAfter: null,
  branch: 'jarvis/next-free-slot',
  log: [
    ['status', 'Queued', 0],
    ['log', 'Sent to Jarvis.', 3],
    ['status', 'Started', 30],
    ['log', 'Cloned jarvis-ops/booking-site', 41],
    ['command', '$ npm ci', 45],
    ['command', '$ git checkout -b jarvis/next-free-slot', 110],
    ['log', 'Added nextFreeSlot() to src/lib/availability.ts, reusing the existing slot search', 420],
    ['log', 'Showed “Next free: today 3:15 PM” under each barber on the booking page', 690],
    ['command', '$ npm test', 760],
    ['log', '41 passed, 1 failed', 812],
    ['error', 'availability.test.ts: a barber with no free time this week showed “Next free: undefined”', 815],
    ['log', 'Now shows “Fully booked this week” in that case, and added a test for it', 990],
    ['command', '$ npm test', 1010],
    ['log', '43 passed', 1058],
    ['status', 'Waiting for your approval', 1440],
  ],
}

const WAITING_PLAN: TaskPlan = {
  steps: [],
  afterApproval: [
    { kind: 'command', message: '$ git push origin jarvis/next-free-slot' },
    { kind: 'log', message: 'Opened pull request #91 on jarvis-ops/booking-site' },
    { kind: 'log', message: 'Preview deploy is up on the pull request' },
  ],
  result: {
    branch: 'jarvis/next-free-slot',
    result_summary:
      'Each barber on the booking page now shows their next free time, or “Fully booked this week”. Added nextFreeSlot() on top of the existing slot search, with tests for both cases.',
    pr_url: pr('jarvis-ops/booking-site', 91),
  },
}

const STORIES: readonly TaskStory[] = [
  {
    repo: 'jarvis-ops/shop-dashboard',
    title: 'Add Burnet Road’s new Thursday hours to the dashboard',
    instructions:
      'Add Burnet Road’s new Thursday hours to the dashboard\n\nThursdays are now 10 AM to 7 PM. Update the hours card and the weekly calendar.',
    status: 'queued',
    createdMinutesAgo: 14,
    startedAfter: null,
    finishedAfter: null,
    log: [
      ['status', 'Queued', 0],
      ['log', 'Scheduled to start at 11 PM, after the shops close, because it redeploys the dashboard.', 5],
    ],
  },
  {
    repo: 'jarvis-ops/booking-site',
    title: 'Fix booking times showing an hour off after the clocks changed',
    instructions:
      'Fix booking times showing an hour off after the clocks changed\n\nTwo customers said the confirmation page showed 3 PM for a 2 PM booking. Started after daylight saving ended.',
    status: 'done',
    createdMinutesAgo: 170,
    startedAfter: 20,
    finishedAfter: 1560,
    branch: 'jarvis/fix-booking-timezone',
    result_summary:
      'The confirmation page formatted times in UTC-5 instead of the shop’s timezone, so they were an hour off after daylight saving ended. It now uses each shop’s IANA timezone, with a test across the November change.',
    pr_url: pr('jarvis-ops/booking-site', 88),
    log: [
      ['status', 'Queued', 0],
      ['log', 'Sent to Jarvis.', 2],
      ['status', 'Started', 20],
      ['log', 'Cloned jarvis-ops/booking-site', 31],
      ['command', '$ git checkout -b jarvis/fix-booking-timezone', 90],
      ['log', 'Found a hard-coded “-05:00” offset in src/lib/dates.ts', 380],
      ['log', 'Switched to the shop’s timezone (America/Chicago) using Intl.DateTimeFormat', 610],
      ['command', '$ npm test', 700],
      ['log', '42 passed', 744],
      ['status', 'Waiting for your approval', 900],
      ['status', 'Approved by you', 1320],
      ['command', '$ git push origin jarvis/fix-booking-timezone', 1340],
      ['log', 'Opened pull request #88 on jarvis-ops/booking-site', 1380],
      ['status', 'Done', 1560],
    ],
  },
  {
    repo: 'jarvis-ops/booking-site',
    title: 'Take a $10 deposit from first-time clients when they book online',
    instructions:
      'Take a $10 deposit from first-time clients when they book online\n\nOnly for people with no past visits. Returning clients book like before. The deposit comes off the price at the shop.',
    status: 'done',
    createdMinutesAgo: 26 * 60 + 15,
    startedAfter: 15,
    finishedAfter: 2400,
    branch: 'jarvis/first-visit-deposit',
    result_summary:
      'New clients now pay a $10 deposit at checkout; anyone with a past visit skips it. The deposit shows on the receipt and comes off the price at the shop. Added tests for both kinds of client.',
    pr_url: pr('jarvis-ops/booking-site', 86),
    log: [
      ['status', 'Queued', 0],
      ['log', 'Sent to Jarvis.', 3],
      ['status', 'Started', 15],
      ['log', 'Cloned jarvis-ops/booking-site', 27],
      ['command', '$ git checkout -b jarvis/first-visit-deposit', 80],
      ['log', 'Checked past visits by phone number before showing the checkout step', 900],
      ['log', 'Added the $10 deposit as a line item that comes off the price at the shop', 1500],
      ['command', '$ npm test', 1800],
      ['log', '40 passed', 1846],
      ['command', '$ git push origin jarvis/first-visit-deposit', 2200],
      ['log', 'Opened pull request #86 on jarvis-ops/booking-site', 2250],
      ['status', 'Done', 2400],
    ],
  },
  {
    repo: 'jarvis-ops/jarvis-backend',
    title: 'Text me a summary of the day at 8 PM',
    instructions:
      'Text me a summary of the day at 8 PM\n\nCalls, bookings, missed calls per shop, and anything waiting for me. Skip it on days the shops are closed.',
    status: 'done',
    createdMinutesAgo: 3 * 24 * 60 + 200,
    startedAfter: 25,
    finishedAfter: 3100,
    branch: 'jarvis/daily-summary-text',
    result_summary:
      'Added a job that texts you at 8 PM with calls, bookings and missed calls for each shop, plus anything waiting for your approval. It skips days when every shop is closed.',
    pr_url: pr('jarvis-ops/jarvis-backend', 142),
    log: [
      ['status', 'Queued', 0],
      ['log', 'Sent to Jarvis.', 2],
      ['status', 'Started', 25],
      ['log', 'Cloned jarvis-ops/jarvis-backend', 40],
      ['command', '$ git checkout -b jarvis/daily-summary-text', 100],
      ['log', 'Added a scheduled job at 20:00 America/Chicago in src/jobs/daily-summary.ts', 1200],
      ['log', 'Reused get_brief for the numbers so they match the app', 1700],
      ['command', '$ npm test', 2600],
      ['log', '118 passed', 2690],
      ['command', '$ git push origin jarvis/daily-summary-text', 2900],
      ['log', 'Opened pull request #142 on jarvis-ops/jarvis-backend', 2950],
      ['status', 'Done', 3100],
    ],
  },
  {
    repo: 'jarvis-ops/shop-dashboard',
    title: 'Upgrade the dashboard to the new charts library',
    instructions:
      'Upgrade the dashboard to the new charts library\n\nMove from the old chart components to the new major version. Keep the weekly calls chart looking the same.',
    status: 'failed',
    createdMinutesAgo: 22 * 60 + 40,
    startedAfter: 10,
    finishedAfter: 1980,
    error:
      'The type check failed after the upgrade: 14 errors in src/charts/WeeklyCalls.tsx, because the new version renamed the axis props. Nothing was pushed.',
    log: [
      ['status', 'Queued', 0],
      ['log', 'Sent to Jarvis.', 2],
      ['status', 'Started', 10],
      ['log', 'Cloned jarvis-ops/shop-dashboard', 22],
      ['command', '$ npm install charts@latest', 70],
      ['log', 'Updated 3 chart components to the new imports', 900],
      ['command', '$ npm run typecheck', 1500],
      ['error', '14 errors in src/charts/WeeklyCalls.tsx: xAxisProps no longer exists', 1560],
      ['log', 'Tried mapping the old axis props to the new ones; 9 errors left', 1900],
      ['status', 'Failed', 1980],
    ],
  },
  {
    repo: 'jarvis-ops/receptionist-agent',
    title: 'Rename “Kids cut” to “Youth cut” everywhere',
    instructions:
      'Rename “Kids cut” to “Youth cut” everywhere\n\nIn the prompts, the price list and the booking codes.',
    status: 'cancelled',
    createdMinutesAgo: 2 * 24 * 60 + 90,
    startedAfter: 12,
    finishedAfter: 260,
    log: [
      ['status', 'Queued', 0],
      ['log', 'Sent to Jarvis.', 2],
      ['status', 'Started', 12],
      ['log', 'Cloned jarvis-ops/receptionist-agent', 24],
      ['log', 'Found “Kids cut” in 11 places, including the booking system’s service codes', 200],
      ['status', 'Cancelled by you', 260],
    ],
  },
]

export function seedCode(now: Date, ids: Ids): CodeSeed {
  const tasks: Task[] = []
  const task_events: TaskEvent[] = []

  function build(story: TaskStory): Task {
    const createdAt = addMinutes(now, -story.createdMinutesAgo)
    const at = (seconds: number) => iso(addSeconds(createdAt, seconds))
    const lastLog = story.log.at(-1)?.[2] ?? 0
    const id = ids.next('task')
    const task: Task = {
      id,
      // The Jarvis backend's own id, once it has picked the task up.
      external_id: story.startedAfter === null ? null : `jv_${id.replace('task-', '')}`,
      title: story.title,
      repo: story.repo,
      instructions: story.instructions,
      status: story.status,
      branch: story.branch ?? null,
      result_summary: story.result_summary ?? null,
      pr_url: story.pr_url ?? null,
      error: story.error ?? null,
      created_at: at(0),
      updated_at: at(story.finishedAfter ?? lastLog),
      started_at: story.startedAfter === null ? null : at(story.startedAfter),
      finished_at: story.finishedAfter === null ? null : at(story.finishedAfter),
    }
    tasks.push(task)
    for (const [kind, message, seconds] of story.log) {
      task_events.push({ id: ids.next('event'), task_id: task.id, kind, message, created_at: at(seconds) })
    }
    return task
  }

  const running = build(RUNNING)
  const waiting = build(WAITING)
  const [, doneToday, , , failed] = STORIES.map(build)

  const waitingAsked = iso(addSeconds(new Date(waiting.created_at), 1440))
  const waitingApproval: Approval = {
    id: ids.next('approval'),
    kind: 'code',
    title: 'Push jarvis/next-free-slot and open a pull request on jarvis-ops/booking-site?',
    detail:
      'Each barber on the booking page will show their next free time, or “Fully booked this week”. 3 files changed and all 43 tests pass. Nothing goes live until you merge.',
    task_id: waiting.id,
    shop_id: null,
    status: 'pending',
    requested_at: waitingAsked,
    decided_at: null,
    expires_at: iso(addMinutes(new Date(waitingAsked), 24 * 60)),
    created_at: waitingAsked,
  }

  const doneAsked = iso(addSeconds(new Date(doneToday.created_at), 900))
  const doneApproval: Approval = {
    id: ids.next('approval'),
    kind: 'code',
    title: 'Push jarvis/fix-booking-timezone and open a pull request on jarvis-ops/booking-site?',
    detail:
      'Booking confirmations will show times in the shop’s own timezone. 2 files changed and all 42 tests pass.',
    task_id: doneToday.id,
    shop_id: null,
    status: 'approved',
    requested_at: doneAsked,
    decided_at: iso(addSeconds(new Date(doneToday.created_at), 1320)),
    expires_at: null,
    created_at: doneAsked,
  }

  return {
    tasks,
    task_events,
    approvals: [waitingApproval, doneApproval],
    plans: new Map([
      [running.id, RUNNING_PLAN],
      [waiting.id, WAITING_PLAN],
    ]),
    runningTaskId: running.id,
    waitingTaskId: waiting.id,
    waitingApprovalId: waitingApproval.id,
    doneTodayTaskId: doneToday.id,
    failedTaskId: failed.id,
  }
}
