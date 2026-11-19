/**
 * The one error type routes throw. `message` is a plain sentence the owner
 * sees as-is (docs/app-api.md, "Errors").
 */
export type ErrorCode = 'unauthorized' | 'forbidden' | 'invalid' | 'not_found' | 'not_configured' | 'upstream' | 'internal'

export class ApiError extends Error {
  status: number
  code: ErrorCode

  constructor(status: number, code: ErrorCode, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export const invalid = (message: string) => new ApiError(400, 'invalid', message)
export const tooLate = (message: string) => new ApiError(409, 'invalid', message)
export const notFound = (message: string) => new ApiError(404, 'not_found', message)
export const unauthorized = (message = 'Your session has ended. Sign in again.') =>
  new ApiError(401, 'unauthorized', message)
export const tooMany = (message = 'Too many tries. Wait a minute, then try again.') =>
  new ApiError(429, 'invalid', message)
export const notConfigured = (message: string) => new ApiError(503, 'not_configured', message)
export const upstream = (message: string) => new ApiError(502, 'upstream', message)

export const SAY = {
  noShop: 'Couldn’t find that shop.',
  noCall: 'Couldn’t find that call.',
  noTask: 'Couldn’t find that task.',
  noApproval: 'Couldn’t find that request. It may have been withdrawn.',
  noAlert: 'Couldn’t find that alert.',
  noEntry: 'Couldn’t find that entry. It may have been deleted.',
  noDecision: 'Couldn’t find that decision. It may have been deleted.',
  wrongPassword: 'That email and password don’t match.',
  wrongCode: 'That code is wrong or has expired. Ask for a new one.',
}
