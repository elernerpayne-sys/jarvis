/**
 * connection-status
 *
 * Tells the owner whether ElevenLabs, Twilio, Notion and the Jarvis backend
 * are reachable with the secrets that are set. Always answers 200 with four
 * entries in that order; a service that is down is reported inside its own
 * entry. The four checks run at the same time, each with its own deadline,
 * and one failing can never change another's result.
 *
 *   POST (empty body)  →  200 { "connections": [ ×4 ] }
 *
 * `detail` is one plain sentence for the owner. It names a secret by its
 * name when that helps, and never contains a secret's value or anything a
 * third party sent back, apart from the display name of the agent or
 * workspace the owner connected.
 */
import { type AuthDeps, ownerEndpoint } from '../_shared/auth.ts'
import {
  ELEVENLABS_API,
  elevenLabsConfig,
  elevenLabsProblem,
  outcomeLabel,
} from '../_shared/elevenlabs.ts'
import { type Env, listNames, secret } from '../_shared/env.ts'
import { type FetchLike, type HttpOutcome, httpRequest, parseJson, seconds } from '../_shared/fetch.ts'
import { describeError, isRecord, jsonResponse } from '../_shared/http.ts'
import { jarvisBackend, jarvisConfig } from '../_shared/jarvis.ts'

const TAG = 'connection-status'
const CHECK_TIMEOUT_MS = 6_000
const NOTION_VERSION = '2022-06-28'

export type ServiceKey = 'elevenlabs' | 'twilio' | 'notion' | 'jarvis'
export type ConnectionState = 'connected' | 'not_configured' | 'error'

export interface ConnectionStatus {
  service: ServiceKey
  state: ConnectionState
  detail: string
  /** How long the service took to answer, or null when nothing was asked. */
  latency_ms: number | null
  checked_at: string
}

interface Finding {
  state: ConnectionState
  detail: string
  latency_ms: number | null
}

export interface StatusDeps {
  env: Env
  fetch: FetchLike
  auth: AuthDeps
  now: () => Date
  /** Overridden in tests. */
  timeoutMs?: number
}

type CheckContext = Pick<StatusDeps, 'env' | 'fetch'> & { timeoutMs: number }

export function handleConnectionStatus(request: Request, deps: StatusDeps): Promise<Response> {
  return ownerEndpoint(request, deps.auth, TAG, async () => {
    return jsonResponse({ connections: await checkConnections(deps) })
  })
}

/** The four checks, in contract order. Never rejects. */
export function checkConnections(deps: Omit<StatusDeps, 'auth'>): Promise<ConnectionStatus[]> {
  const context: CheckContext = {
    env: deps.env,
    fetch: deps.fetch,
    timeoutMs: deps.timeoutMs ?? CHECK_TIMEOUT_MS,
  }
  const checks: [ServiceKey, (context: CheckContext) => Promise<Finding>][] = [
    ['elevenlabs', checkElevenLabs],
    ['twilio', checkTwilio],
    ['notion', checkNotion],
    ['jarvis', checkJarvis],
  ]
  return Promise.all(
    checks.map(async ([service, check]): Promise<ConnectionStatus> => {
      let finding: Finding
      try {
        finding = await check(context)
      } catch (error) {
        // A bug in one check must not take the other three down with it.
        console.error(`${TAG}: ${service} check crashed`, describeError(error))
        finding = {
          state: 'error',
          detail: "This check couldn't be completed. Try again.",
          latency_ms: null,
        }
      }
      return { service, ...finding, checked_at: deps.now().toISOString() }
    }),
  )
}

// ── ElevenLabs ──────────────────────────────────────────────────────────────

async function checkElevenLabs(context: CheckContext): Promise<Finding> {
  const config = elevenLabsConfig(context.env)
  if (config.state === 'missing') {
    return {
      state: 'not_configured',
      detail: `Add ${listNames(config.missing)} to connect the voice agent.`,
      latency_ms: null,
    }
  }

  const outcome = await httpRequest(
    context.fetch,
    `${ELEVENLABS_API}/v1/convai/agents/${encodeURIComponent(config.agentId)}`,
    { headers: { 'xi-api-key': config.apiKey }, timeoutMs: context.timeoutMs, tag: TAG },
  )
  if (outcome.kind !== 'response' || !outcome.ok) {
    console.error(`${TAG}: elevenlabs`, outcomeLabel(outcome))
    return {
      state: 'error',
      detail: elevenLabsProblem(outcome, context.timeoutMs, true),
      latency_ms: outcome.ms,
    }
  }

  const body = parseJson(outcome.text)
  const name = isRecord(body) ? label(body.name) : null
  return {
    state: 'connected',
    detail: name ? `Connected to the agent "${name}".` : 'Connected to your voice agent.',
    latency_ms: outcome.ms,
  }
}

// ── Twilio ──────────────────────────────────────────────────────────────────

async function checkTwilio(context: CheckContext): Promise<Finding> {
  const sid = secret(context.env, 'TWILIO_ACCOUNT_SID')
  const token = secret(context.env, 'TWILIO_AUTH_TOKEN')
  return sid && token
    ? await checkTwilioAccount(context, sid, token)
    : await inferTwilioFromElevenLabs(context)
}

async function checkTwilioAccount(
  context: CheckContext,
  sid: string,
  token: string,
): Promise<Finding> {
  // The SID becomes part of the address, so it must look exactly like one.
  if (!/^AC[0-9a-fA-F]{32}$/.test(sid)) {
    return {
      state: 'error',
      detail: "TWILIO_ACCOUNT_SID doesn't look right. It starts with AC and is 34 characters long.",
      latency_ms: null,
    }
  }

  const outcome = await httpRequest(
    context.fetch,
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}.json`,
    {
      headers: { Authorization: `Basic ${base64(`${sid}:${token}`)}` },
      timeoutMs: context.timeoutMs,
      tag: TAG,
    },
  )
  if (outcome.kind !== 'response' || !outcome.ok) {
    console.error(`${TAG}: twilio`, outcomeLabel(outcome))
    return { state: 'error', detail: twilioProblem(outcome, context.timeoutMs), latency_ms: outcome.ms }
  }

  const body = parseJson(outcome.text)
  const accountStatus = isRecord(body) && typeof body.status === 'string' ? body.status : null
  if (accountStatus === 'suspended' || accountStatus === 'closed') {
    return {
      state: 'error',
      detail: `Twilio says this account is ${accountStatus}.`,
      latency_ms: outcome.ms,
    }
  }
  return { state: 'connected', detail: 'Connected to your Twilio account.', latency_ms: outcome.ms }
}

function twilioProblem(outcome: HttpOutcome, timeoutMs: number): string {
  if (outcome.kind === 'timeout') return `Twilio didn't answer within ${seconds(timeoutMs)}.`
  if (outcome.kind === 'network') return "Twilio couldn't be reached."
  const status = outcome.status
  if (status === 401 || status === 403) {
    return 'Twilio rejected the credentials. Check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.'
  }
  if (status === 404) return "Twilio doesn't know this account. Check TWILIO_ACCOUNT_SID."
  if (status === 429) return 'Twilio is limiting requests right now. Try again in a minute.'
  if (status >= 500) return `Twilio is having trouble right now (HTTP ${status}).`
  return `Twilio answered in a way Jarvis didn't expect (HTTP ${status}).`
}

/**
 * Without Twilio credentials of our own, the numbers attached to the
 * ElevenLabs account are the evidence: Jarvis answers the phone through them.
 */
async function inferTwilioFromElevenLabs(context: CheckContext): Promise<Finding> {
  const config = elevenLabsConfig(context.env)
  if (config.state === 'missing') {
    return {
      state: 'not_configured',
      detail: 'Connect ElevenLabs first. Jarvis looks for your Twilio numbers there.',
      latency_ms: null,
    }
  }

  const outcome = await httpRequest(context.fetch, `${ELEVENLABS_API}/v1/convai/phone-numbers`, {
    headers: { 'xi-api-key': config.apiKey },
    timeoutMs: context.timeoutMs,
    tag: TAG,
  })
  if (outcome.kind !== 'response' || !outcome.ok) {
    console.error(`${TAG}: twilio via elevenlabs`, outcomeLabel(outcome))
    return {
      state: 'error',
      detail: `${phoneListProblem(outcome, context.timeoutMs)}, so the Twilio numbers couldn't be checked.`,
      latency_ms: outcome.ms,
    }
  }

  const numbers = phoneNumbersFrom(parseJson(outcome.text))
  if (numbers === null) {
    console.error(`${TAG}: phone-number list had an unexpected shape`)
    return {
      state: 'error',
      detail: "ElevenLabs listed its phone numbers in a form Jarvis didn't recognise.",
      latency_ms: outcome.ms,
    }
  }

  const twilio = numbers.filter(
    (entry) => typeof entry.provider === 'string' && entry.provider.toLowerCase() === 'twilio',
  ).length
  if (twilio === 0) {
    return {
      state: 'not_configured',
      detail: 'No Twilio numbers are attached to ElevenLabs yet.',
      latency_ms: outcome.ms,
    }
  }
  return {
    state: 'connected',
    detail: `${twilio} Twilio ${twilio === 1 ? 'number' : 'numbers'} attached in ElevenLabs.`,
    latency_ms: outcome.ms,
  }
}

function phoneListProblem(outcome: HttpOutcome, timeoutMs: number): string {
  if (outcome.kind === 'timeout') return `ElevenLabs didn't answer within ${seconds(timeoutMs)}`
  if (outcome.kind === 'network') return "ElevenLabs couldn't be reached"
  if (outcome.status === 401 || outcome.status === 403) return 'ElevenLabs rejected the API key'
  return `ElevenLabs couldn't list its phone numbers (HTTP ${outcome.status})`
}

/** The list is documented both as a bare array and as { phone_numbers: [...] }. */
function phoneNumbersFrom(body: unknown): Record<string, unknown>[] | null {
  const list = Array.isArray(body) ? body : isRecord(body) ? body.phone_numbers : null
  return Array.isArray(list) ? list.filter(isRecord) : null
}

// ── Notion ──────────────────────────────────────────────────────────────────

async function checkNotion(context: CheckContext): Promise<Finding> {
  const key = secret(context.env, 'NOTION_API_KEY')
  if (!key) {
    return { state: 'not_configured', detail: "Notion sync isn't set up yet.", latency_ms: null }
  }

  const outcome = await httpRequest(context.fetch, 'https://api.notion.com/v1/users/me', {
    headers: { Authorization: `Bearer ${key}`, 'Notion-Version': NOTION_VERSION },
    timeoutMs: context.timeoutMs,
    tag: TAG,
  })
  if (outcome.kind !== 'response' || !outcome.ok) {
    console.error(`${TAG}: notion`, outcomeLabel(outcome))
    return { state: 'error', detail: notionProblem(outcome, context.timeoutMs), latency_ms: outcome.ms }
  }

  const body = parseJson(outcome.text)
  const bot = isRecord(body) && isRecord(body.bot) ? body.bot : null
  const workspace = bot ? label(bot.workspace_name) : null
  return {
    state: 'connected',
    detail: workspace ? `Connected to the Notion workspace "${workspace}".` : 'Connected to Notion.',
    latency_ms: outcome.ms,
  }
}

function notionProblem(outcome: HttpOutcome, timeoutMs: number): string {
  if (outcome.kind === 'timeout') return `Notion didn't answer within ${seconds(timeoutMs)}.`
  if (outcome.kind === 'network') return "Notion couldn't be reached."
  const status = outcome.status
  if (status === 401) return 'Notion rejected the key. Check NOTION_API_KEY.'
  if (status === 403) return "Notion won't let this key do that. Check the integration's access."
  if (status === 429) return 'Notion is limiting requests right now. Try again in a minute.'
  if (status >= 500) return `Notion is having trouble right now (HTTP ${status}).`
  return `Notion answered in a way Jarvis didn't expect (HTTP ${status}).`
}

// ── Jarvis backend ──────────────────────────────────────────────────────────

async function checkJarvis(context: CheckContext): Promise<Finding> {
  const config = jarvisConfig(context.env)
  if (config.state === 'missing') {
    return { state: 'not_configured', detail: config.detail, latency_ms: null }
  }
  if (config.state === 'invalid') {
    return { state: 'error', detail: config.detail, latency_ms: null }
  }

  const result = await jarvisBackend(config, context.fetch, context.timeoutMs).health()
  if (!result.ok) {
    console.error(`${TAG}: jarvis`, result.status === null ? result.kind : `HTTP ${result.status}`)
    return { state: 'error', detail: result.detail, latency_ms: result.ms }
  }
  return { state: 'connected', detail: 'Your Jarvis backend is up.', latency_ms: result.ms }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * A display name from a third party, made safe to drop into a sentence:
 * control characters and quotes removed, whitespace collapsed, kept short.
 */
function label(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const clean = value
    // deno-lint-ignore no-control-regex
    .replace(/[\u0000-\u001f\u007f"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!clean) return null
  return clean.length > 60 ? `${clean.slice(0, 59)}…` : clean
}

/** Base64 of the UTF-8 bytes (btoa alone throws on anything outside Latin-1). */
function base64(text: string): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary)
}
