import { Buffer } from 'node:buffer'
import { CursorCodec } from './ids.js'
import { PtcWebError } from './errors.js'

export interface CursorScope {
  snapshot: string
  operation: string
  scope: string
}

export function cursorOffset(codec: CursorCodec, cursor: string | undefined, expected: CursorScope): number {
  if (cursor === undefined) return 0
  const value = codec.decode<Record<string, unknown>>(cursor)
  if (
    value.snapshot !== expected.snapshot ||
    value.operation !== expected.operation ||
    value.scope !== expected.scope ||
    typeof value.offset !== 'number' ||
    !Number.isSafeInteger(value.offset) ||
    value.offset < 0
  ) {
    throw new PtcWebError('invalid_cursor', 'cursor does not match this snapshot and operation')
  }
  return value.offset
}

export function textPage(
  value: string,
  offset: number,
  maximumBytes: number,
): { content: string; nextOffset: number | null } {
  const source = Buffer.from(value, 'utf8')
  if (offset > source.byteLength)
    throw new PtcWebError('invalid_cursor', 'cursor position is outside the representation')
  if (offset === source.byteLength) return { content: '', nextOffset: null }
  let end = Math.min(source.byteLength, offset + maximumBytes)
  while (end > offset && end < source.byteLength && (source[end] ?? 0) >= 0x80 && (source[end] ?? 0) < 0xc0) end -= 1
  if (end === offset)
    throw new PtcWebError('resource_limit_exceeded', 'page byte limit is too small for the next UTF-8 character')
  return { content: source.subarray(offset, end).toString('utf8'), nextOffset: end < source.byteLength ? end : null }
}

export function boundedArrayPage<T>(
  values: readonly T[],
  offset: number,
  requested: number,
  maxResponseBytes: number,
  envelope: (items: T[], nextOffset: number | null) => Record<string, unknown>,
): { items: T[]; nextOffset: number | null } {
  if (offset > values.length) throw new PtcWebError('invalid_cursor', 'cursor position is outside the result set')
  const items: T[] = []
  let index = offset
  while (index < values.length && items.length < requested) {
    const candidate = [...items, values[index] as T]
    const candidateNext = index + 1 < values.length ? index + 1 : null
    if (Buffer.byteLength(JSON.stringify(envelope(candidate, candidateNext)), 'utf8') > maxResponseBytes) break
    items.push(values[index] as T)
    index += 1
  }
  if (items.length === 0 && index < values.length)
    throw new PtcWebError('resource_limit_exceeded', 'one result record exceeds the response byte limit')
  return { items, nextOffset: index < values.length ? index : null }
}
