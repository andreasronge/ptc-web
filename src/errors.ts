export type ErrorCode =
  | 'access_denied'
  | 'blocked'
  | 'capture_limit_exceeded'
  | 'expired'
  | 'invalid_cursor'
  | 'invalid_request'
  | 'not_found'
  | 'resource_limit_exceeded'
  | 'unavailable'

export class PtcWebError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'PtcWebError'
  }
}

export function publicError(error: unknown): { code: ErrorCode; message: string } {
  if (error instanceof PtcWebError) return { code: error.code, message: error.message }
  if (error instanceof Error && error.name === 'AbortError') {
    return { code: 'unavailable', message: 'operation cancelled' }
  }
  return { code: 'unavailable', message: 'browser operation failed' }
}
