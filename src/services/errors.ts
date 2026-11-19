/**
 * The one error type the service layer throws.
 *
 * `message` is written for the owner and is safe to show on screen.
 * `code` lets a screen react (for example, show "not found" instead of a
 * retry button).
 */
export type ServiceErrorCode =
  | 'not_found'
  | 'unauthorized'
  | 'not_configured'
  | 'invalid'
  | 'network'
  | 'unknown'

export class ServiceError extends Error {
  readonly code: ServiceErrorCode

  constructor(code: ServiceErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ServiceError'
    this.code = code
  }
}

export function isServiceError(error: unknown): error is ServiceError {
  return error instanceof ServiceError
}

/** A sentence that is always safe to put on screen. */
export function errorMessage(error: unknown, fallback = 'Something went wrong.'): string {
  if (isServiceError(error)) return error.message
  if (error instanceof Error && error.message) return error.message
  return fallback
}

export function isNotFound(error: unknown): boolean {
  return isServiceError(error) && error.code === 'not_found'
}
