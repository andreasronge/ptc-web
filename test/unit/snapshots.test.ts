import assert from 'node:assert/strict'
import test from 'node:test'
import { SnapshotStore } from '../../src/snapshots.js'

const input = {
  handleId: 'p_test',
  url: 'https://example.test/',
  title: 'Test',
  html: '<p>test</p>',
  capturedBytes: 11,
  sourceBytes: 11,
  truncated: false,
  blockedRequests: 0,
  networkRequests: 1,
  captureLimitBytes: 100,
}

test('expires immutable snapshots and retains a bounded expiry diagnosis', () => {
  let now = 1_000
  const store = new SnapshotStore(50, 1, () => now)
  const snapshot = store.create(input)
  assert.equal(store.get(snapshot.id).html, '<p>test</p>')
  assert.throws(() => store.create(input), /snapshot limit/)
  now = 1_051
  assert.throws(() => store.get(snapshot.id), /expired/)
  assert.equal(store.size, 0)
  assert.doesNotThrow(() => store.create(input))
})
