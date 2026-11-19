/**
 * Everything the server reads from its environment, in one place.
 *
 * Secrets stay in this object and are only ever put in an outbound request
 * header. Nothing here is logged (see `describeConfig`, which prints names
 * and "set"/"not set" only).
 */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface Config {
  port: number
  host: string
  dataDir: string
  /** The built app (dist/). Missing is fine: the API still works. */
  staticDir: string
  /** Origins allowed to call /app/ from another site (CORS). Same-origin needs none. */
  allowedOrigins: string[]
  /** How many proxy hops to trust in X-Forwarded-For (0 = use the socket address). */
  trustProxy: number

  ownerEmail: string | null
  ownerPassword: string | null

  resendApiKey: string | null
  mailFrom: string | null

  elevenLabsApiKey: string | null
  elevenLabsAgentId: string | null
  elevenLabsWebhookSecret: string | null
  /** agent id → shop phone, for post-call webhooks that carry no called number. */
  elevenLabsAgentShops: Map<string, string>

  twilioAccountSid: string | null
  twilioAuthToken: string | null
  twilioFromNumber: string | null

  notionApiKey: string | null

  taskRunnerUrl: string | null
  taskRunnerKey: string | null

  webhookSecret: string | null

  /** Upstream base URLs. Fixed by default; overridable only from the environment (tests use local fakes). */
  urls: {
    elevenLabs: string
    twilio: string
    notion: string
    resend: string
  }
  /** Per-call limit for every outbound request, in ms. */
  outboundTimeoutMs: number
  /** How often /app/events sends a heartbeat comment, in ms (25 s; tests shorten it). */
  heartbeatMs: number
}

type Env = Record<string, string | undefined>

function value(env: Env, name: string): string | null {
  const raw = env[name]
  if (raw === undefined) return null
  const trimmed = raw.trim()
  return trimmed === '' ? null : trimmed
}

function baseUrl(env: Env, name: string, fallback: string): string {
  return (value(env, name) ?? fallback).replace(/\/+$/, '')
}

function agentShops(raw: string | null): Map<string, string> {
  const map = new Map<string, string>()
  for (const pair of (raw ?? '').split(',')) {
    const [agent, phone] = pair.split('=').map((part) => part?.trim() ?? '')
    if (agent && phone) map.set(agent, phone)
  }
  return map
}

const here = fileURLToPath(new URL('.', import.meta.url))
/** jarvis/ (the folder holding package.json, dist/ and server/). */
export const APP_ROOT = resolve(here, '..', '..')

export function loadConfig(env: Env = process.env): Config {
  const port = Number(value(env, 'PORT') ?? 8080)
  const trust = value(env, 'TRUST_PROXY')
  // Railway and Render put one proxy in front of the app and say so in their own variables.
  const onKnownHost = Boolean(value(env, 'RAILWAY_ENVIRONMENT') ?? value(env, 'RAILWAY_ENVIRONMENT_NAME') ?? value(env, 'RENDER'))
  const trustProxy =
    trust === null ? (onKnownHost ? 1 : 0) : trust === 'true' ? 1 : trust === 'false' ? 0 : Math.max(0, Number(trust) || 0)

  return {
    port: Number.isInteger(port) && port >= 0 && port < 65536 ? port : 8080,
    host: value(env, 'HOST') ?? '0.0.0.0',
    dataDir: resolve(value(env, 'DATA_DIR') ?? resolve(APP_ROOT, 'data')),
    staticDir: resolve(value(env, 'STATIC_DIR') ?? resolve(APP_ROOT, 'dist')),
    allowedOrigins: (value(env, 'ALLOWED_ORIGINS') ?? '')
      .split(',')
      .map((origin) => origin.trim().replace(/\/+$/, ''))
      .filter((origin) => origin !== ''),
    trustProxy,

    ownerEmail: value(env, 'OWNER_EMAIL'),
    ownerPassword: value(env, 'OWNER_PASSWORD'),

    resendApiKey: value(env, 'RESEND_API_KEY'),
    mailFrom: value(env, 'MAIL_FROM'),

    elevenLabsApiKey: value(env, 'ELEVENLABS_API_KEY'),
    elevenLabsAgentId: value(env, 'ELEVENLABS_AGENT_ID'),
    elevenLabsWebhookSecret: value(env, 'ELEVENLABS_WEBHOOK_SECRET'),
    elevenLabsAgentShops: agentShops(value(env, 'ELEVENLABS_AGENT_SHOPS')),

    twilioAccountSid: value(env, 'TWILIO_ACCOUNT_SID'),
    twilioAuthToken: value(env, 'TWILIO_AUTH_TOKEN'),
    twilioFromNumber: value(env, 'TWILIO_FROM_NUMBER'),

    notionApiKey: value(env, 'NOTION_API_KEY'),

    taskRunnerUrl: value(env, 'TASK_RUNNER_URL')?.replace(/\/+$/, '') ?? null,
    taskRunnerKey: value(env, 'TASK_RUNNER_KEY'),

    webhookSecret: value(env, 'JARVIS_WEBHOOK_SECRET'),

    urls: {
      elevenLabs: baseUrl(env, 'ELEVENLABS_API_URL', 'https://api.elevenlabs.io'),
      twilio: baseUrl(env, 'TWILIO_API_URL', 'https://api.twilio.com'),
      notion: baseUrl(env, 'NOTION_API_URL', 'https://api.notion.com'),
      resend: baseUrl(env, 'RESEND_API_URL', 'https://api.resend.com'),
    },
    outboundTimeoutMs: Number(value(env, 'OUTBOUND_TIMEOUT_MS') ?? 8000) || 8000,
    heartbeatMs: Math.max(100, Number(value(env, 'SSE_HEARTBEAT_MS') ?? 25_000) || 25_000),
  }
}

/** What is configured, by name only. Safe to log. */
export function describeConfig(config: Config): string {
  const set = (on: unknown) => (on ? 'set' : 'not set')
  return [
    `data: ${config.dataDir}`,
    `app: ${config.staticDir}`,
    `email codes: ${set(config.resendApiKey && config.mailFrom)}`,
    `voice: ${set(config.elevenLabsApiKey && config.elevenLabsAgentId)}`,
    `elevenlabs webhook: ${set(config.elevenLabsWebhookSecret)}`,
    `twilio: ${set(config.twilioAccountSid && config.twilioAuthToken)}`,
    `notion: ${set(config.notionApiKey)}`,
    `task runner: ${set(config.taskRunnerUrl && config.taskRunnerKey)}`,
    `webhook secret: ${set(config.webhookSecret)}`,
    `cors origins: ${config.allowedOrigins.length}`,
  ].join(', ')
}
