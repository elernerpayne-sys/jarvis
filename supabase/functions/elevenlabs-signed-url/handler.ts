/**
 * elevenlabs-signed-url
 *
 * Gives the owner's app a short-lived signed websocket URL for one voice
 * conversation with the Jarvis agent. The ElevenLabs key stays here; the app
 * only ever receives the signed URL, which stops working after 15 minutes.
 *
 *   POST (empty body)  →  200 { "signed_url": "wss://…" }
 *   401 unauthorized · 403 forbidden · 503 not_configured · 502 upstream
 */
import { type AuthDeps, ownerEndpoint } from '../_shared/auth.ts'
import {
  ELEVENLABS_API,
  elevenLabsConfig,
  elevenLabsProblem,
  outcomeLabel,
} from '../_shared/elevenlabs.ts'
import { type Env, listNames } from '../_shared/env.ts'
import { type FetchLike, httpRequest, parseJson } from '../_shared/fetch.ts'
import { errorResponse, isRecord, jsonResponse } from '../_shared/http.ts'

const TAG = 'elevenlabs-signed-url'
const TIMEOUT_MS = 10_000

export interface SignedUrlDeps {
  env: Env
  fetch: FetchLike
  auth: AuthDeps
  /** Overridden in tests. */
  timeoutMs?: number
}

export function handleSignedUrl(request: Request, deps: SignedUrlDeps): Promise<Response> {
  return ownerEndpoint(request, deps.auth, TAG, async () => {
    const config = elevenLabsConfig(deps.env)
    if (config.state === 'missing') {
      return errorResponse(
        503,
        'not_configured',
        `Voice isn't connected yet. Add ${listNames(config.missing)} to your Supabase secrets.`,
      )
    }

    const timeoutMs = deps.timeoutMs ?? TIMEOUT_MS
    // The address is fixed; the agent id comes from configuration, never from the request.
    const url = `${ELEVENLABS_API}/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(config.agentId)}`
    const outcome = await httpRequest(deps.fetch, url, {
      headers: { 'xi-api-key': config.apiKey },
      timeoutMs,
      tag: TAG,
    })

    if (outcome.kind !== 'response' || !outcome.ok) {
      console.error(`${TAG}: ElevenLabs refused`, outcomeLabel(outcome))
      return errorResponse(502, 'upstream', elevenLabsProblem(outcome, timeoutMs, true))
    }

    const signedUrl = signedUrlFrom(parseJson(outcome.text))
    if (!signedUrl) {
      console.error(`${TAG}: reply had no usable signed_url`)
      return errorResponse(
        502,
        'upstream',
        "ElevenLabs answered, but didn't send a link to start the conversation. Try again.",
      )
    }

    return jsonResponse({ signed_url: signedUrl })
  })
}

/** The signed URL from the reply, only if it really is a secure websocket address. */
export function signedUrlFrom(body: unknown): string | null {
  if (!isRecord(body) || typeof body.signed_url !== 'string') return null
  try {
    return new URL(body.signed_url).protocol === 'wss:' ? body.signed_url : null
  } catch {
    return null
  }
}
