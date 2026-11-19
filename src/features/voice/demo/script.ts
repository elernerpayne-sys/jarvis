/**
 * What Jarvis says in demo mode. Every line is built from the same sample
 * data the screens show, read through the service layer, so the demo never
 * claims something the rest of the app contradicts.
 */
import { formatDayTime, plural } from '@/lib/format'
import type { Approval, Brief, ShopSummary, Task, TaskStatus } from '@/lib/types'
import type { JarvisService } from '@/services/types'

export type DemoDataSource = Pick<
  JarvisService,
  'getBrief' | 'listApprovals' | 'listTasks' | 'listShops'
>

export interface BriefingData {
  brief: Brief
  /** Pending approvals, newest first. */
  approvals: Approval[]
  /** Newest first. */
  tasks: Task[]
}

export interface AnswerData extends BriefingData {
  shops: ShopSummary[]
}

/** Resolves with null when the data can't be read; never rejects. */
export async function loadBriefingData(source: DemoDataSource): Promise<BriefingData | null> {
  try {
    const [brief, approvals, tasks] = await Promise.all([
      source.getBrief(),
      source.listApprovals({ status: 'pending' }),
      source.listTasks(),
    ])
    return { brief, approvals, tasks }
  } catch {
    return null
  }
}

/** Resolves with null when the data can't be read; never rejects. */
export async function loadAnswerData(source: DemoDataSource): Promise<AnswerData | null> {
  try {
    const [briefing, shops] = await Promise.all([loadBriefingData(source), source.listShops()])
    return briefing ? { ...briefing, shops } : null
  } catch {
    return null
  }
}

export const DEMO_INTRO =
  'You’re talking to the demo, so everything I tell you is sample data. I can’t hear you here, but you can type to me. Here’s where today stands.'

export const DATA_UNAVAILABLE =
  'I can’t reach the data right now, so I have nothing to report. Try again in a moment.'

const TOPICS = 'today’s calls, missed calls, bookings, approvals, coding tasks, or a shop by name'

const DEMO_OUTRO = 'That’s the brief. Type a question whenever you like.'

function missedLine(brief: Brief): string {
  if (brief.missed_calls === 0) return 'Nothing was missed.'
  if (brief.missed_calls === 1) return 'One call was missed. It’s in that shop’s call log.'
  return `${brief.missed_calls} calls were missed. They’re in each shop’s call log.`
}

function callsLine(brief: Brief): string {
  if (brief.calls_answered === 0 && brief.missed_calls === 0) {
    return 'No calls have come in yet today.'
  }
  const answered = plural(brief.calls_answered, 'call')
  const booked = plural(brief.bookings_made, 'appointment')
  return `I’ve answered ${answered} today and booked ${booked}. ${missedLine(brief)}`
}

function bookingsLine(brief: Brief): string {
  if (brief.bookings_made === 0) return 'I haven’t booked anything yet today.'
  return `I’ve booked ${plural(brief.bookings_made, 'appointment')} today, out of ${plural(brief.calls_answered, 'call')} answered.`
}

function approvalsLine(approvals: Approval[]): string {
  const [newest] = approvals
  if (!newest) return 'Nothing is waiting for your approval.'
  if (approvals.length === 1) return `One thing is waiting for your approval. ${newest.title}`
  return `${approvals.length} things are waiting for your approval. The newest: ${newest.title}`
}

/** The task most worth mentioning: whatever is in flight, else the newest. */
function taskInFocus(tasks: Task[]): Task | undefined {
  const order: TaskStatus[] = ['running', 'needs_approval', 'queued']
  for (const status of order) {
    const match = tasks.find((task) => task.status === status)
    if (match) return match
  }
  return tasks[0]
}

function describeTask(task: Task): string {
  switch (task.status) {
    case 'running':
      return `I’m working on “${task.title}” in ${task.repo}.`
    case 'needs_approval':
      return `“${task.title}” is paused until you approve the next step.`
    case 'queued':
      return `“${task.title}” is queued and will start shortly.`
    case 'done':
      return `The latest task, “${task.title}”, is done.`
    case 'failed':
      return `“${task.title}” failed. Its log has the details.`
    case 'cancelled':
      return `The latest task, “${task.title}”, was cancelled.`
  }
}

function tasksLine(data: BriefingData): string {
  const task = taskInFocus(data.tasks)
  const current = task ? describeTask(task) : 'No coding tasks are in the queue.'
  const finished = data.brief.tasks_finished
  return finished > 0 ? `${current} ${plural(finished, 'task')} finished today.` : current
}

/** The spoken briefing after the intro: one entry per turn. */
export function briefingTurns(data: BriefingData | null): string[] {
  if (!data) return [DATA_UNAVAILABLE]
  return [
    callsLine(data.brief),
    approvalsLine(data.approvals),
    `On the coding side: ${tasksLine(data)} ${DEMO_OUTRO}`,
  ]
}

// ── Typed questions ────────────────────────────────────────────────────────

/** Words too common in shop names to identify one. */
const GENERIC_NAME_WORDS = new Set(['barber', 'barbers', 'barbershop', 'shop', 'cuts', 'with', 'and', 'the'])

function mentionedShop(question: string, shops: ShopSummary[]): ShopSummary | undefined {
  return shops.find((shop) => {
    const name = shop.name.toLowerCase()
    if (question.includes(name)) return true
    return name
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 4 && !GENERIC_NAME_WORDS.has(word))
      .some((word) => new RegExp(`\\b${word}\\b`).test(question))
  })
}

/** "today, 3:05 PM", "Thursday, 9:00 AM": a day and time that sits inside a sentence. */
function midSentence(dayTime: string): string {
  return /^(Today|Tomorrow|Yesterday)\b/.test(dayTime)
    ? dayTime.charAt(0).toLowerCase() + dayTime.slice(1)
    : dayTime
}

function shopLine(shop: ShopSummary): string {
  if (shop.status === 'paused') return `${shop.name} is paused, so I’m not answering its phone right now.`
  const calls = plural(shop.calls_today, 'call')
  const today = `${shop.name} has had ${calls} today: ${shop.bookings_today} booked, ${shop.missed_today} missed.`
  return shop.next_appointment_at
    ? `${today} The next appointment is ${midSentence(formatDayTime(shop.next_appointment_at))}.`
    : today
}

function missedAnswer(data: AnswerData): string {
  const where = data.shops
    .filter((shop) => shop.missed_today > 0)
    .map((shop) => `${shop.missed_today} at ${shop.name}`)
  const line = missedLine(data.brief)
  return where.length > 0 && data.brief.missed_calls > 0 ? `${line} That’s ${where.join(' and ')}.` : line
}

const GREETING = /^(hi|hey|hello|yo|good (morning|afternoon|evening))\b|\bhello\b/
const HELP = /\bhelp\b|what can you|what do you know/
const MISSED = /\bmiss|\bfail(ed)? call|\bdropped\b/
const BOOKINGS = /\bbook|\bappointment/
const CALLS = /\bcalls?\b|\bphones?\b|\breception/
const APPROVALS = /\bapprov|\bwaiting\b|\bsign[- ]off\b|\bpermission/
const TASKS = /\btasks?\b|\bcod(e|ing)\b|\brepos?\b|\bbranch|\bpull request|\bdeploy/
const SUMMARY = /\bbrief|\btoday\b|\bsummary\b|\bupdate\b|\bstatus\b|how('|’)?s it going|what('|’)?s (happening|new|up)/

/**
 * A canned answer to a typed question, picked by keyword. `data` is null
 * when the sample data could not be read.
 */
export function answerQuestion(question: string, data: AnswerData | null): string {
  const asked = question.trim().toLowerCase()

  if (HELP.test(asked)) return `In the demo I can tell you about ${TOPICS}.`
  if (!data) {
    return GREETING.test(asked)
      ? 'Hello. I can’t reach the sample data right now, so I have nothing to report. Try again in a moment.'
      : DATA_UNAVAILABLE
  }

  const shop = mentionedShop(asked, data.shops)
  if (shop) return shopLine(shop)
  if (MISSED.test(asked)) return missedAnswer(data)
  if (BOOKINGS.test(asked)) return bookingsLine(data.brief)
  if (CALLS.test(asked)) return callsLine(data.brief)
  if (APPROVALS.test(asked)) return approvalsLine(data.approvals)
  if (TASKS.test(asked)) return tasksLine(data)
  if (SUMMARY.test(asked)) return `${callsLine(data.brief)} ${approvalsLine(data.approvals)}`
  if (GREETING.test(asked)) return `Hello. This is the demo, so ask me about ${TOPICS}.`

  return `This is the demo, so I can only answer from the sample data. Ask me about ${TOPICS}.`
}
