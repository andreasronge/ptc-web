import { createHash, createHmac, randomBytes } from 'node:crypto'
import { PtcWebError } from './errors.js'

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('base64url')}`
}

export function digest(value: string | Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

export class CursorCodec {
  constructor(private readonly key = randomBytes(32)) {}

  encode(payload: Record<string, unknown>): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const signature = createHmac('sha256', this.key).update(body).digest('base64url')
    return `${body}.${signature}`
  }

  decode<T extends Record<string, unknown>>(cursor: string): T {
    const [body, signature, extra] = cursor.split('.')
    if (body === undefined || signature === undefined || extra !== undefined) throw this.invalid()
    const expected = createHmac('sha256', this.key).update(body).digest('base64url')
    if (signature.length !== expected.length || !timingSafeText(signature, expected)) throw this.invalid()
    try {
      const value: unknown = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
      if (value === null || typeof value !== 'object' || Array.isArray(value)) throw this.invalid()
      return value as T
    } catch (error) {
      if (error instanceof PtcWebError) throw error
      throw this.invalid()
    }
  }

  private invalid(): PtcWebError {
    return new PtcWebError('invalid_cursor', 'cursor is invalid or belongs to another server process')
  }
}

function timingSafeText(left: string, right: string): boolean {
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  return difference === 0
}
