/**
 * POST /hooks/elevenlabs: ElevenLabs "post-call" webhooks, so every call the
 * receptionist agent finishes lands in Jarvis as a call with its transcript
 * and summary, without any code of yours in between.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ ASSUMED, NOT VERIFIED. The ElevenLabs docs couldn't be reached while  │
 * │ this was written; everything below is from memory of their format.    │
 * │ If ElevenLabs changes or differs, this file is the only one to fix.   │
 * │                                                                      │
 * │ Header:  ElevenLabs-Signature: t=<unix seconds>,v0=<hex hmac>         │
 * │          hmac = HMAC-SHA256(ELEVENLABS_WEBHOOK_SECRET, "<t>.<body>")  │
 * │          (accepted within 30 minutes of t)                            │
 * │ Body:    { "type": "post_call_transcription" | "call_initiation_failure"│
 * │                    | "post_call_audio",                               │
 * │            "event_timestamp": <unix seconds>,                         │
 * │            "data": {                                                  │
 * │              "agent_id", "conversation_id", "status",                 │
 * │              "transcript": [ { "role": "agent" | "user",              │
 * │                                "message", "time_in_call_secs" } ],    │
 * │              "metadata": { "start_time_unix_secs", "call_duration_secs",│
 * │                "phone_call": { "agent_number", "external_number",     │
 * │                                "call_sid", "direction" } },           │
 * │              "analysis": { "transcript_summary", "call_successful",   │
 * │                "data_collection_results": { "<name>": { "value" } } },│
 * │              "conversation_initiation_client_data": {                 │
 * │                "dynamic_variables": { "system__called_number",        │
 * │                  "system__caller_id" } },                             │
 * │              "failure_reason" (call_initiation_failure only) } }      │
 * │                                                                      │
 * │ Optional, if you add Data Collection items with these names in the    │
 * │ agent: "outcome" (booked/answered/message/transferred), "caller_name".│
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * Which shop: the number that was called (agent_number, or the
 * system__called_number variable). A number Jarvis hasn't seen becomes a new
 * shop named after it. With no number (a test call from the dashboard), the
 * agent id is looked up in ELEVENLABS_AGENT_SHOPS ("agent_id=+1512…"), and
 * failing that the only shop, if there is exactly one.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { CallOutcome, TranscriptTurn } from '../../src/lib/types.ts'
import type { Config } from './config.ts'
import { ApiError } from './errors.ts'
import { readBody, sendJson, TooLarge } from './http.ts'
import { ReplayGuard, verify } from './signature.ts'
import type { Store } from './store.ts'
import { E164, formatPhone, isRecord, log, logError, parseJson } from './util.ts'

export const SIGNATURE_HEADER = 'elevenlabs-signature'
export const TOLERANCE_SECONDS = 30 * 60
const BODY_LIMIT = 1024 * 1024
const OUTCOMES: readonly CallOutcome[] = ['booked', 'answered', 'message', 'transferred', 'missed', 'failed']

const record = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {})
const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null)
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)

/** "+1 (512) 555-0142", "15125550142" → "+15125550142" when it can be read as E.164. */
function phone(value: unknown): string | null {
  const raw = str(value)
  if (!raw) return null
  const digits = raw.replace(/[^\d+]/g, '')
  const withPlus = digits.startsWith('+') ? digits : `+${digits}`
  return E164.test(withPlus) ? withPlus : null
}

function collected(analysis: Record<string, unknown>, name: string): unknown {
  const results = record(analysis.data_collection_results)
  const entry = results[name]
  return isRecord(entry) ? entry.value : entry
}

export interface MappedCall {
  external_id: string
  agent_id: string | null
  called_number: string | null
  caller_phone: string
  caller_name: string | null
  started_at: string
  duration_seconds: number
  outcome: CallOutcome
  summary: string | null
  transcript: TranscriptTurn[]
}

/** The ElevenLabs body as a Jarvis call, or null for events Jarvis doesn't store (audio). */
export function mapPostCall(body: unknown): MappedCall | null {
  const root = record(body)
  const type = str(root.type)
  if (type !== 'post_call_transcription' && type !== 'call_initiation_failure') return null
  const data = record(root.data)
  const metadata = record(data.metadata)
  const phoneCall = record(metadata.phone_call)
  const analysis = record(data.analysis)
  const variables = record(record(data.conversation_initiation_client_data).dynamic_variables)
  // call_initiation_failure carries the provider's own fields (Twilio's To/From/CallSid) under metadata.body.
  const providerBody = record(metadata.body)

  const conversationId = str(data.conversation_id) ?? str(phoneCall.call_sid) ?? str(providerBody.CallSid)
  if (!conversationId) return null

  const startSeconds = num(metadata.start_time_unix_secs) ?? num(root.event_timestamp) ?? Math.floor(Date.now() / 1000)
  const transcript: TranscriptTurn[] = []
  for (const turn of Array.isArray(data.transcript) ? data.transcript : []) {
    const entry = record(turn)
    const text = str(entry.message)
    if (!text) continue // tool calls and silences have no message
    transcript.push({
      role: entry.role === 'agent' ? 'agent' : 'caller',
      text: text.slice(0, 5000),
      t: Math.max(0, num(entry.time_in_call_secs) ?? 0),
    })
  }

  let outcome: CallOutcome
  const said = str(collected(analysis, 'outcome'))?.toLowerCase()
  if (type === 'call_initiation_failure') {
    const reason = (str(data.failure_reason) ?? '').toLowerCase()
    outcome = reason.includes('busy') || reason.includes('no-answer') || reason.includes('no_answer') ? 'missed' : 'failed'
  } else if (str(data.status) === 'failed') {
    outcome = 'failed'
  } else if (said && OUTCOMES.includes(said as CallOutcome)) {
    outcome = said as CallOutcome
  } else if (!transcript.some((turn) => turn.role === 'caller')) {
    // The caller never said anything: hung up before the greeting.
    outcome = 'missed'
  } else {
    outcome = 'answered'
  }

  const summary =
    str(analysis.transcript_summary) ??
    (type === 'call_initiation_failure' ? `The call couldn’t be connected${str(data.failure_reason) ? ` (${str(data.failure_reason)})` : ''}.` : null)

  return {
    external_id: conversationId.slice(0, 200),
    agent_id: str(data.agent_id),
    called_number: phone(phoneCall.agent_number) ?? phone(variables.system__called_number) ?? phone(providerBody.To),
    caller_phone: phone(phoneCall.external_number) ?? phone(variables.system__caller_id) ?? phone(providerBody.From) ?? 'unknown',
    caller_name: str(collected(analysis, 'caller_name'))?.slice(0, 200) ?? null,
    started_at: new Date(startSeconds * 1000).toISOString(),
    duration_seconds: Math.max(0, Math.min(86400, Math.round(num(metadata.call_duration_secs) ?? 0))),
    outcome,
    summary: summary?.slice(0, 10000) ?? null,
    transcript,
  }
}

function findShop(store: Store, config: Config, call: MappedCall): string | null {
  if (call.called_number) {
    const id = store.findShopId({ shop_phone: call.called_number })
    if (id) return id
    log(`elevenlabs: a call came in on a new number; adding it as a shop`)
    return store.upsertShop({ name: `Shop at ${formatPhone(call.called_number)}`, phone: call.called_number })
  }
  const mapped = call.agent_id ? config.elevenLabsAgentShops.get(call.agent_id) : undefined
  if (mapped) {
    const id = store.findShopId({ shop_phone: mapped })
    if (id) return id
  }
  const shops = store.db.prepare('SELECT id FROM shops LIMIT 2').all() as { id: string }[]
  return shops.length === 1 ? shops[0].id : null
}

const guard = new ReplayGuard()

export async function handleElevenLabsHook(req: IncomingMessage, res: ServerResponse, store: Store, config: Config): Promise<void> {
  if (!config.elevenLabsWebhookSecret) {
    req.resume()
    throw new ApiError(503, 'not_configured', 'Set ELEVENLABS_WEBHOOK_SECRET on the Jarvis server to accept ElevenLabs calls.')
  }
  let raw: Buffer
  try {
    raw = await readBody(req, BODY_LIMIT)
  } catch (error) {
    if (error instanceof TooLarge) throw new ApiError(413, 'invalid', 'That request is over 1 MB. Turn off audio in the ElevenLabs webhook.')
    throw error
  }
  const verdict = verify({
    secret: config.elevenLabsWebhookSecret,
    header: req.headers[SIGNATURE_HEADER],
    body: raw,
    scheme: 'v0',
    toleranceSeconds: TOLERANCE_SECONDS,
    guard,
  })
  if (verdict === 'replay') {
    // Storing a call twice changes nothing, so a resend is simply acknowledged.
    sendJson(res, 200, { ok: true, duplicate: true })
    return
  }
  if (verdict !== 'ok') throw new ApiError(401, 'unauthorized', 'The signature doesn’t match.')

  const body = parseJson(raw.toString('utf8'))
  if (body === undefined) throw new ApiError(400, 'invalid', 'That request wasn’t valid JSON.')
  const call = mapPostCall(body)
  if (!call) {
    sendJson(res, 200, { ok: true, ignored: true })
    return
  }
  try {
    const id = store.write((tx) => {
      const shopId = findShop(store, config, call)
      if (!shopId) return null
      return store.upsertCall(tx, {
        external_id: call.external_id,
        shop_id: shopId,
        caller_phone: call.caller_phone,
        caller_name: call.caller_name,
        started_at: call.started_at,
        duration_seconds: call.duration_seconds,
        outcome: call.outcome,
        summary: call.summary,
        transcript: call.transcript,
      })
    })
    if (!id) {
      log('elevenlabs: a call had no called number and no shop could be matched; set ELEVENLABS_AGENT_SHOPS')
      sendJson(res, 200, { ok: false, ignored: true, reason: 'No shop matches this call.' })
      return
    }
    log(`elevenlabs: stored a ${call.outcome} call`)
    sendJson(res, 200, { ok: true, id })
  } catch (error) {
    logError('elevenlabs: storing the call failed', error)
    throw new ApiError(500, 'internal', 'Jarvis couldn’t store this call.')
  }
}
