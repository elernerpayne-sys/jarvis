/**
 * What the two ElevenLabs-facing functions share: where the API lives, which
 * secrets it needs, and how to describe a failure in one plain sentence.
 *
 * The API key travels in the `xi-api-key` header only. It is never put in a
 * URL, a response or a log line.
 */
import { type Env, missingSecrets, secret } from './env.ts'
import { type HttpOutcome, seconds } from './fetch.ts'

export const ELEVENLABS_API = 'https://api.elevenlabs.io'

export type ElevenLabsConfig =
  | { state: 'ready'; apiKey: string; agentId: string }
  | { state: 'missing'; missing: string[] }

export function elevenLabsConfig(env: Env): ElevenLabsConfig {
  const missing = missingSecrets(env, ['ELEVENLABS_API_KEY', 'ELEVENLABS_AGENT_ID'])
  if (missing.length > 0) return { state: 'missing', missing }
  return {
    state: 'ready',
    apiKey: secret(env, 'ELEVENLABS_API_KEY') ?? '',
    agentId: secret(env, 'ELEVENLABS_AGENT_ID') ?? '',
  }
}

/**
 * One sentence for a call that did not come back 2xx. `aboutAgent` is true
 * when the request named the agent, so a 404 can be blamed on the agent id.
 */
export function elevenLabsProblem(
  outcome: HttpOutcome,
  timeoutMs: number,
  aboutAgent: boolean,
): string {
  if (outcome.kind === 'timeout') return `ElevenLabs didn't answer within ${seconds(timeoutMs)}.`
  if (outcome.kind === 'network') return "ElevenLabs couldn't be reached."

  const status = outcome.status
  if (status === 401) return 'ElevenLabs rejected the API key. Check ELEVENLABS_API_KEY.'
  if (status === 403) {
    return aboutAgent
      ? "ElevenLabs won't let this API key use the agent. Check the key's permissions and that ELEVENLABS_AGENT_ID belongs to the same account."
      : "ElevenLabs won't let this API key do that. Check the key's permissions."
  }
  if (aboutAgent && status === 404) {
    return "ElevenLabs doesn't know this agent. Check ELEVENLABS_AGENT_ID."
  }
  if (aboutAgent && (status === 400 || status === 422)) {
    return "ElevenLabs didn't accept the agent id. Check ELEVENLABS_AGENT_ID."
  }
  if (status === 429) return 'ElevenLabs is limiting requests right now. Try again in a minute.'
  if (status >= 500) return `ElevenLabs is having trouble right now (HTTP ${status}).`
  return `ElevenLabs answered in a way Jarvis didn't expect (HTTP ${status}).`
}

/** A short label for the log line: "timeout", "network" or "HTTP 401". */
export function outcomeLabel(outcome: HttpOutcome): string {
  return outcome.kind === 'response' ? `HTTP ${outcome.status}` : outcome.kind
}
