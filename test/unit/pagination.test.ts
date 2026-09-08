import assert from 'node:assert/strict'
import test from 'node:test'
import { CursorCodec } from '../../src/ids.js'
import { boundedArrayPage, cursorOffset, textPage } from '../../src/pagination.js'

test('paginates UTF-8 without splitting characters and binds cursors to scope', () => {
  const first = textPage('ab—cd', 0, 4)
  assert.equal(first.content, 'ab')
  assert.equal(first.nextOffset, 2)
  const second = textPage('ab—cd', first.nextOffset, 4)
  assert.equal(second.content, '—c')
  const codec = new CursorCodec(Buffer.alloc(32, 7))
  const scope = { snapshot: 's1', operation: 'read', scope: 'markdown' }
  const cursor = codec.encode({ ...scope, offset: 2 })
  assert.equal(cursorOffset(codec, cursor, scope), 2)
  assert.throws(() => cursorOffset(codec, cursor, { ...scope, snapshot: 's2' }), /does not match/)
  assert.throws(() => cursorOffset(codec, `${cursor}x`, scope), /invalid/)
})

test('bounds record pages by both count and serialized response bytes', () => {
  const values = [{ value: 'a'.repeat(40) }, { value: 'b'.repeat(40) }, { value: 'c'.repeat(40) }]
  const page = boundedArrayPage(values, 0, 3, 100, (items, next) => ({ items, next }))
  assert.equal(page.items.length, 1)
  assert.equal(page.nextOffset, 1)
  assert.throws(
    () => boundedArrayPage([{ value: 'x'.repeat(200) }], 0, 1, 50, (items, next) => ({ items, next })),
    /exceeds/,
  )
})
