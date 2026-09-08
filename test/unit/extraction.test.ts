import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { extractRecords } from '../../src/extraction.js'
import type { Snapshot } from '../../src/snapshots.js'

const root = join(process.cwd(), 'test', 'fixtures')

test('keeps listing fields associated and resolves links against the snapshot URL', async () => {
  const html = await readFile(join(root, 'listing.html'), 'utf8')
  const snapshot = fakeSnapshot(html, 'https://fixture.example/listing.html')
  const result = extractRecords(
    snapshot,
    {
      container: '.story',
      fields: [
        { name: 'id', source: 'attribute', attribute: 'data-id', required: true },
        { name: 'title', selector: '.title', required: true },
        { name: 'url', selector: '.title', source: 'attribute', attribute: 'href', required: true },
        { name: 'score', selector: '.score' },
      ],
    },
    50,
  )
  assert.deepEqual(result.records[0], {
    id: 'a1',
    title: 'Alpha launch',
    url: 'https://fixture.example/stories/alpha',
    score: '81 points',
  })
  assert.equal(result.records.length, 3)
})

test('preserves discussion identities, parents, and deleted records', async () => {
  const html = await readFile(join(root, 'discussion.html'), 'utf8')
  const result = extractRecords(
    fakeSnapshot(html, 'https://fixture.example/thread'),
    {
      container: '.comment',
      fields: [
        { name: 'id', source: 'attribute', attribute: 'data-id', required: true },
        { name: 'parent', source: 'attribute', attribute: 'data-parent', required: true },
        { name: 'author', selector: '.author' },
        { name: 'body', selector: '.body', required: true },
      ],
    },
    50,
  )
  assert.deepEqual(result.records[2], { id: 'c3', parent: 'p1', author: null, body: '[deleted]' })
})

function fakeSnapshot(html: string, url: string): Snapshot {
  return {
    id: 's_test',
    handleId: 'p_test',
    url,
    title: 'fixture',
    html,
    capturedAt: new Date(0).toISOString(),
    expiresAt: new Date(60_000).toISOString(),
    capturedBytes: Buffer.byteLength(html),
    sourceBytes: Buffer.byteLength(html),
    truncated: false,
    blockedRequests: 0,
    networkRequests: 1,
    captureLimitBytes: 1_000_000,
    extractorVersion: 'test',
    contentHash: 'sha256:test',
    representations: new Map(),
  }
}
