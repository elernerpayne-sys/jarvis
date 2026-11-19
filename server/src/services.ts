/**
 * The third parties Jarvis talks to: ElevenLabs (voice), Twilio (texts and
 * calls to the owner), Notion (status only for now), Resend (sign-in codes)
 * and the coding task runner. Keys travel in headers only and never appear
 * in a URL, a response to the app, or a log line.
 */
import type { Alert, ConnectionStatus, ServiceKey } from '../../src/lib/types.ts'
import type { Config } from './config.ts'
import type { Db } from './db.ts'
import { notConfigured, upstream } from './errors.ts'
import type { Outcome } from './outbound.ts'
import { basicAuth, label, seconds, send } from './outbound.ts'
import type { Notify } from './routing.ts'
import { isRecord, log, logError, parseJson } from './util.ts'

const NOTION_VERSION = '2022-06-28'
const CHECK_TIMEOUT_MS = 6_000

// ── Voice ──────────────────────────────────────────────────────────────────

export async function signedVoiceUrl(config: Config): Promise<string> {
  if (!config.elevenLabsApiKey || !config.elevenLabsAgentId) {
    throw notConfigured('Voice isn’t set up yet. Add your ElevenLabs key to the Jarvis backend.')
  }
  const outcome = await send(
    `${config.urls.elevenLabs}/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(config.elevenLabsAgentId)}`,
    { headers: { 'xi-api-key': config.elevenLabsApiKey }, timeoutMs: config.outboundTimeoutMs },
  )
  if (outcome.kind !== 'response' || !outcome.ok) {
    logError(`voice: ElevenLabs signed URL failed (${label(outcome)})`)
    throw upstream(elevenLabsProblem(outcome, config.outboundTimeoutMs))
  }
  const body = parseJson(outcome.text)
  const url = isRecord(body) ? body.signed_url : undefined
  if (typeof url !== 'string' || !url.startsWith('wss://')) {
    logError('voice: ElevenLabs answered without a signed_url')
    throw upstream('ElevenLabs answered in a way Jarvis didn’t expect. Try again in a minute.')
  }
  return url
}

function elevenLabsProblem(outcome: Outcome, timeoutMs: number): string {
  if (outcome.kind === 'timeout') return `ElevenLabs didn’t answer within ${seconds(timeoutMs)}.`
  if (outcome.kind === 'network') return 'ElevenLabs couldn’t be reached.'
  const status = outcome.status
  if (status === 401) return 'ElevenLabs rejected the API key. Check ELEVENLABS_API_KEY.'
  if (status === 403) return 'ElevenLabs won’t let this API key use the agent. Check the key’s permissions.'
  if (status === 404 || status === 400 || status === 422) return 'ElevenLabs doesn’t know this agent. Check ELEVENLABS_AGENT_ID.'
  if (status === 429) return 'ElevenLabs is limiting requests right now. Try again in a minute.'
  if (status >= 500) return `ElevenLabs is having trouble right now (HTTP ${status}).`
  return `ElevenLabs answered in a way Jarvis didn’t expect (HTTP ${status}).`
}

// ── Connections ────────────────────────────────────────────────────────────

interface Finding {
  state: ConnectionStatus['state']
  detail: string
  latency_ms: number | null
}

/** A third party's display name, safe to put in a sentence. */
function safeLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\u0000-\u001f\u007f"“”]/g, '').replace(/\s+/g, ' ').trim()
  if (clean === '') return null
  return clean.length > 60 ? `${clean.slice(0, 57)}…` : clean
}

async function checkElevenLabs(config: Config, timeoutMs: number): Promise<Finding> {
  if (!config.elevenLabsApiKey || !config.elevenLabsAgentId) {
    return { state: 'not_configured', detail: 'Add ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID to connect the voice agent.', latency_ms: null }
  }
  const outcome = await send(`${config.urls.elevenLabs}/v1/convai/agents/${encodeURIComponent(config.elevenLabsAgentId)}`, {
    headers: { 'xi-api-key': config.elevenLabsApiKey },
    timeoutMs,
  })
  if (outcome.kind !== 'response' || !outcome.ok) {
    return { state: 'error', detail: elevenLabsProblem(outcome, timeoutMs), latency_ms: outcome.ms }
  }
  const body = parseJson(outcome.text)
  const name = isRecord(body) ? safeLabel(body.name) : null
  return { state: 'connected', detail: name ? `Agent “${name}” reachable.` : 'Agent reachable.', latency_ms: outcome.ms }
}

async function checkTwilio(config: Config, timeoutMs: number): Promise<Finding> {
  const sid = config.twilioAccountSid
  const token = config.twilioAuthToken
  if (sid && token) {
    if (!/^AC[0-9a-fA-F]{32}$/.test(sid)) {
      return { state: 'error', detail: 'TWILIO_ACCOUNT_SID doesn’t look right. It starts with AC and is 34 characters long.', latency_ms: null }
    }
    const outcome = await send(`${config.urls.twilio}/2010-04-01/Accounts/${sid}.json`, {
      headers: { Authorization: basicAuth(sid, token) },
      timeoutMs,
    })
    if (outcome.kind === 'timeout') return { state: 'error', detail: `Twilio didn’t answer within ${seconds(timeoutMs)}.`, latency_ms: outcome.ms }
    if (outcome.kind === 'network') return { state: 'error', detail: 'Twilio couldn’t be reached.', latency_ms: outcome.ms }
    if (outcome.status === 401 || outcome.status === 403) {
      return { state: 'error', detail: 'Twilio rejected the credentials. Check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.', latency_ms: outcome.ms }
    }
    if (!outcome.ok) return { state: 'error', detail: `Twilio answered with an error (HTTP ${outcome.status}).`, latency_ms: outcome.ms }
    const body = parseJson(outcome.text)
    const status = isRecord(body) && typeof body.status === 'string' ? body.status : null
    if (status === 'suspended' || status === 'closed') {
      return { state: 'error', detail: `Twilio says this account is ${status}.`, latency_ms: outcome.ms }
    }
    const texts = config.twilioFromNumber ? ' Texts and calls to you are on.' : ' Add TWILIO_FROM_NUMBER so Jarvis can text and call you.'
    return { state: 'connected', detail: `Twilio account reachable.${texts}`, latency_ms: outcome.ms }
  }

  // Without Twilio keys, the numbers attached in ElevenLabs are the evidence.
  if (!config.elevenLabsApiKey) {
    return { state: 'not_configured', detail: 'Add a Twilio key to check this, or connect ElevenLabs first.', latency_ms: null }
  }
  const outcome = await send(`${config.urls.elevenLabs}/v1/convai/phone-numbers`, {
    headers: { 'xi-api-key': config.elevenLabsApiKey },
    timeoutMs,
  })
  if (outcome.kind !== 'response' || !outcome.ok) {
    return { state: 'error', detail: `${elevenLabsProblem(outcome, timeoutMs).replace(/\.$/, '')}, so the Twilio numbers couldn’t be checked.`, latency_ms: outcome.ms }
  }
  const body = parseJson(outcome.text)
  const list = Array.isArray(body) ? body : isRecord(body) && Array.isArray(body.phone_numbers) ? body.phone_numbers : null
  if (!list) return { state: 'error', detail: 'ElevenLabs listed its phone numbers in a form Jarvis didn’t recognise.', latency_ms: outcome.ms }
  const twilio = list.filter((entry) => isRecord(entry) && String(entry.provider ?? '').toLowerCase() === 'twilio').length
  if (twilio === 0) return { state: 'not_configured', detail: 'No Twilio numbers are attached to ElevenLabs yet.', latency_ms: outcome.ms }
  return {
    state: 'connected',
    detail: `${twilio} Twilio ${twilio === 1 ? 'number' : 'numbers'} attached in ElevenLabs.`,
    latency_ms: outcome.ms,
  }
}

async function checkNotion(config: Config, timeoutMs: number): Promise<Finding> {
  if (!config.notionApiKey) return { state: 'not_configured', detail: 'Add a Notion key (NOTION_API_KEY) to check this.', latency_ms: null }
  const outcome = await send(`${config.urls.notion}/v1/users/me`, {
    headers: { Authorization: `Bearer ${config.notionApiKey}`, 'Notion-Version': NOTION_VERSION },
    timeoutMs,
  })
  if (outcome.kind === 'timeout') return { state: 'error', detail: `Notion didn’t answer within ${seconds(timeoutMs)}.`, latency_ms: outcome.ms }
  if (outcome.kind === 'network') return { state: 'error', detail: 'Notion couldn’t be reached.', latency_ms: outcome.ms }
  if (outcome.status === 401) return { state: 'error', detail: 'Notion rejected the key. Check NOTION_API_KEY.', latency_ms: outcome.ms }
  if (!outcome.ok) return { state: 'error', detail: `Notion answered with an error (HTTP ${outcome.status}).`, latency_ms: outcome.ms }
  const body = parseJson(outcome.text)
  const workspace = isRecord(body) && isRecord(body.bot) ? safeLabel(body.bot.workspace_name) : null
  return { state: 'connected', detail: workspace ? `Connected to the Notion workspace “${workspace}”.` : 'Connected to Notion.', latency_ms: outcome.ms }
}

async function checkJarvis(config: Config, db: Db, timeoutMs: number): Promise<Finding> {
  const started = Date.now()
  try {
    db.prepare('SELECT 1').get()
  } catch (error) {
    logError('connections: database check failed', error)
    return { state: 'error', detail: 'The database isn’t answering.', latency_ms: null }
  }
  const runner = taskRunner(config)
  if (!runner) {
    return {
      state: 'connected',
      detail: 'Database OK. No task runner is connected yet, so coding tasks wait in the queue.',
      latency_ms: Date.now() - started,
    }
  }
  const outcome = await runner.health(timeoutMs)
  if (outcome.kind !== 'response' || !outcome.ok) {
    return { state: 'error', detail: `Database OK, but ${runnerProblem(outcome, timeoutMs)}`, latency_ms: outcome.ms }
  }
  return { state: 'connected', detail: 'Database OK. The task runner is up.', latency_ms: outcome.ms }
}

/** Four checks at once, each with its own deadline; one failing never affects another. */
export async function checkConnections(config: Config, db: Db, timeoutMs = Math.min(CHECK_TIMEOUT_MS, config.outboundTimeoutMs)): Promise<ConnectionStatus[]> {
  const checks: [ServiceKey, () => Promise<Finding>][] = [
    ['elevenlabs', () => checkElevenLabs(config, timeoutMs)],
    ['twilio', () => checkTwilio(config, timeoutMs)],
    ['notion', () => checkNotion(config, timeoutMs)],
    ['jarvis', () => checkJarvis(config, db, timeoutMs)],
  ]
  return Promise.all(
    checks.map(async ([service, check]): Promise<ConnectionStatus> => {
      let finding: Finding
      try {
        finding = await check()
      } catch (error) {
        logError(`connections: ${service} check crashed`, error)
        finding = { state: 'error', detail: 'This check couldn’t be completed. Try again.', latency_ms: null }
      }
      return { service, ...finding, checked_at: new Date().toISOString() }
    }),
  )
}

// ── Task runner ────────────────────────────────────────────────────────────

export interface TaskRunner {
  health(timeoutMs?: number): Promise<Outcome>
  submit(task: { task_id: string; title: string; repo: string; instructions: string }): Promise<Outcome>
  cancel(taskId: string): Promise<Outcome>
  decide(approvalId: string, decision: 'approved' | 'denied', taskId: string | null): Promise<Outcome>
}

/** The runner contract is in docs/runner.md. Null when TASK_RUNNER_URL or TASK_RUNNER_KEY is missing. */
export function taskRunner(config: Config): TaskRunner | null {
  const base = config.taskRunnerUrl
  const key = config.taskRunnerKey
  if (!base || !key) return null
  const call = (method: string, path: string, body?: unknown, timeoutMs = 10_000) =>
    send(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      timeoutMs,
    })
  return {
    health: (timeoutMs) => call('GET', '/health', undefined, timeoutMs),
    submit: (task) => call('POST', '/tasks', task),
    cancel: (taskId) => call('POST', `/tasks/${encodeURIComponent(taskId)}/cancel`, {}),
    decide: (approvalId, decision, taskId) =>
      call('POST', `/approvals/${encodeURIComponent(approvalId)}/decision`, { decision, task_id: taskId }),
  }
}

export function runnerProblem(outcome: Outcome, timeoutMs = 10_000): string {
  if (outcome.kind === 'timeout') return `the task runner didn’t answer within ${seconds(timeoutMs)}.`
  if (outcome.kind === 'network') return 'the task runner couldn’t be reached.'
  if (outcome.status === 401 || outcome.status === 403) return 'the task runner rejected the key. Check TASK_RUNNER_KEY.'
  return `the task runner answered with an error (HTTP ${outcome.status}).`
}

/** A short reason from the runner's error body, if it sent one ({ "error": "…" } or { "error": { "message": "…" } }). */
export function runnerReason(outcome: Outcome): string | null {
  if (outcome.kind !== 'response') return null
  const body = parseJson(outcome.text)
  if (!isRecord(body)) return null
  const error = body.error
  const message = typeof error === 'string' ? error : isRecord(error) && typeof error.message === 'string' ? error.message : null
  return message ? (safeLabel(message.replace(/[“”"]/g, "'")) ?? null) : null
}

// ── Email (sign-in codes) ──────────────────────────────────────────────────

export function mailConfigured(config: Config): boolean {
  return Boolean(config.resendApiKey && config.mailFrom)
}

export async function sendCodeEmail(config: Config, to: string, code: string): Promise<void> {
  if (!config.resendApiKey || !config.mailFrom) return
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`
  const outcome = await send(`${config.urls.resend}/emails`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.resendApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: config.mailFrom,
      to: [to],
      subject: `Your Jarvis code: ${spaced}`,
      text: `Your Jarvis sign-in code is ${spaced}.\n\nIt works once, for the next 10 minutes. If you didn't ask for it, ignore this email.`,
    }),
    timeoutMs: config.outboundTimeoutMs,
  })
  if (outcome.kind !== 'response' || !outcome.ok) logError(`mail: Resend didn't send the code (${label(outcome)})`)
  else log('mail: sign-in code sent')
}

// ── Alerts by text or call (Twilio) ────────────────────────────────────────

function twilioReady(config: Config): config is Config & { twilioAccountSid: string; twilioAuthToken: string; twilioFromNumber: string } {
  return Boolean(config.twilioAccountSid && config.twilioAuthToken && config.twilioFromNumber)
}

function xml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/** Sends the text or places the call an alert was routed to. Never throws. */
export async function deliverAlert(config: Config, alert: Alert, notify: Notify): Promise<void> {
  if (notify.channel === 'in_app' || !notify.phone) return
  if (!twilioReady(config)) {
    log(`alerts: ${notify.channel} wanted for a ${alert.type} alert, but Twilio texting isn't set up (TWILIO_FROM_NUMBER)`)
    return
  }
  const message = [alert.title, alert.body].filter(Boolean).join('. ').replace(/\.\.+/g, '.').slice(0, 1200)
  const form = new URLSearchParams({ To: notify.phone, From: config.twilioFromNumber })
  let path: string
  if (notify.channel === 'text') {
    form.set('Body', `Jarvis: ${message}`)
    path = 'Messages.json'
  } else {
    form.set('Twiml', `<Response><Say>This is Jarvis. ${xml(message)}</Say><Pause length="1"/><Say>${xml(message)}</Say></Response>`)
    path = 'Calls.json'
  }
  try {
    const outcome = await send(`${config.urls.twilio}/2010-04-01/Accounts/${encodeURIComponent(config.twilioAccountSid)}/${path}`, {
      method: 'POST',
      headers: {
        Authorization: basicAuth(config.twilioAccountSid, config.twilioAuthToken),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
      timeoutMs: config.outboundTimeoutMs,
    })
    if (outcome.kind !== 'response' || !outcome.ok) logError(`alerts: Twilio ${notify.channel} failed (${label(outcome)})`)
    else log(`alerts: ${notify.channel} sent for a ${alert.type} alert`)
  } catch (error) {
    logError(`alerts: Twilio ${notify.channel} failed`, error)
  }
}
