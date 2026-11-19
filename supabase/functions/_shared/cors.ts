/**
 * CORS for the three functions the app calls from the browser.
 *
 * The allowed request headers come from the Supabase SDK itself, so a
 * redeploy picks up any header a newer supabase-js starts sending. Access is
 * decided by the owner's bearer token, never by cookies, so a wildcard origin
 * gives a page on another site nothing it could not already do with curl.
 *
 * The webhook is called server to server and sends no CORS headers at all.
 */
import { corsHeaders as sdkCorsHeaders } from 'npm:@supabase/supabase-js@2/cors'

export const corsHeaders: Readonly<Record<string, string>> = {
  ...sdkCorsHeaders,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** The answer to a browser's preflight. Sent before any authentication. */
export function preflight(): Response {
  return new Response(null, {
    status: 204,
    headers: { ...corsHeaders, 'Access-Control-Max-Age': '3600' },
  })
}

/** The same response with the CORS headers added. */
export function withCors(response: Response): Response {
  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(corsHeaders)) headers.set(name, value)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
