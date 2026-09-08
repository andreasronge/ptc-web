import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { representation } from '../../src/content.js'
import type { Snapshot } from '../../src/snapshots.js'

test('held-out card layout retains title and authored paragraphs without a site rule', async () => {
  const html = await readFile(join(process.cwd(), 'test', 'fixtures', 'held-out', 'article-card-layout.html'), 'utf8')
  const snapshot: Snapshot = {
    id: 'held_out',
    handleId: 'none',
    url: 'https://held-out.example/forest',
    title: 'Forest survey',
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
  const markdown = representation(snapshot, 'markdown', 'article').content
  assert.match(markdown, /Forest survey finds rare owl/)
  assert.match(markdown, /night survey documented/)
  assert.doesNotMatch(markdown, /Weekly digest/)
})
