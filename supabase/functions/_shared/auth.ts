/**
 * The owner check, shared by every function the app calls.
 *
 * Exactly one account may use Jarvis. A request is let through only when all
 * of these hold:
 *   1. it carries `Authorization: Bearer <token>`;
 *   2. the token is a genuine, unexpired session token from this project,
 *      for a signed-in user (role "authenticated", with a user id);
 *   3. reading `settings.owner_id` with that same token returns a row. Row-
 *      level security shows the row to the owner and to nobody else, so this
 *      is the database's own verdict on the caller;
 *   4. that owner_id equals the user id inside the verified token.
 *
 * Nothing in the request body or query string is ever used to decide who the
 * caller is. Only after this passes may a handler ask for the service-role
 * client.
 */
import { preflight, withCors } from './cors.ts'
import { describeError, errorResponse, internalError, methodNotAllowed } from './http.ts'

export interface VerifiedToken {
  /** The user id the token was issued to. */
  sub: string | null
  /** "authenticated" for a signed-in user; "anon" for the public key. */
  role: string | null
}

export type OwnerLookup =
  /** The row the caller is allowed to see: its owner_id, or null when no row is visible. */
  | { kind: 'found'; ownerId: string | null }
  /** The database itself refused the token. */
  | { kind: 'unauthorized' }
  /** The lookup could not be completed. */
  | { kind: 'failed'; reason: string }

export interface AuthDeps {
  /**
   * Checks signature and expiry. Resolves null for a token that is not valid;
   * rejects only when the check itself could not be carried out.
   */
  verifyToken(token: string): Promise<VerifiedToken | null>
  /** Reads settings.owner_id through a client that carries the caller's own token. */
  readOwnerId(token: string): Promise<OwnerLookup>
}

export interface Owner {
  userId: string
}

export type OwnerCheck = { ok: true; owner: Owner } | { ok: false; response: Response }

const SIGN_IN = 'Sign in to continue.'
const EXPIRED = 'Your session has expired. Sign in again.'
const NOT_OWNER = 'This account is not the owner of this Jarvis.'

/** Three base64url segments. Rejects API keys and junk before any network call. */
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
const MAX_TOKEN_LENGTH = 8192

export function bearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization') ?? ''
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim())
  const token = match?.[1]
  if (!token || token.length > MAX_TOKEN_LENGTH || !JWT_SHAPE.test(token)) return null
  return token
}

export async function requireOwner(request: Request, auth: AuthDeps): Promise<OwnerCheck> {
  const token = bearerToken(request)
  if (!token) return { ok: false, response: errorResponse(401, 'unauthorized', SIGN_IN) }

  const verified = await auth.verifyToken(token)
  if (!verified) return { ok: false, response: errorResponse(401, 'unauthorized', EXPIRED) }
  if (verified.role !== 'authenticated' || !verified.sub) {
    return { ok: false, response: errorResponse(401, 'unauthorized', SIGN_IN) }
  }

  const lookup = await auth.readOwnerId(token)
  if (lookup.kind === 'unauthorized') {
    return { ok: false, response: errorResponse(401, 'unauthorized', EXPIRED) }
  }
  if (lookup.kind === 'failed') {
    console.error('owner-check: could not read settings', lookup.reason.slice(0, 300))
    return { ok: false, response: internalError() }
  }
  if (!lookup.ownerId || lookup.ownerId.toLowerCase() !== verified.sub.toLowerCase()) {
    return { ok: false, response: errorResponse(403, 'forbidden', NOT_OWNER) }
  }

  return { ok: true, owner: { userId: verified.sub } }
}

/**
 * Wraps a handler for an owner-only endpoint: answers the preflight, allows
 * only POST, runs the owner check before anything else, turns any thrown
 * error into a 500, and puts the CORS headers on every response.
 */
export async function ownerEndpoint(
  request: Request,
  auth: AuthDeps,
  tag: string,
  run: (owner: Owner) => Promise<Response>,
): Promise<Response> {
  if (request.method === 'OPTIONS') return preflight()

  let response: Response
  try {
    if (request.method !== 'POST') {
      response = methodNotAllowed('POST, OPTIONS')
    } else {
      const check = await requireOwner(request, auth)
      response = check.ok ? await run(check.owner) : check.response
    }
  } catch (error) {
    console.error(`${tag}: unhandled error`, describeError(error))
    response = internalError()
  }
  return withCors(response)
}
