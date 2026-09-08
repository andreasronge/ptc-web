import assert from 'node:assert/strict'
import test from 'node:test'
import { JsonRpcClient } from '../support/json-rpc-client.js'
import { startFixtureServer } from '../support/fixture-server.js'

test('serves discovery and a complete capture/read/extract lifecycle over MCP stdio', async (t) => {
  const fixture = await startFixtureServer()
  const client = new JsonRpcClient({
    ...process.env,
    PTC_WEB_ALLOW_LOCAL_ORIGINS: fixture.origin,
    PTC_WEB_MAX_RESPONSE_BYTES: '8192',
  })
  t.after(async () => {
    await client.close()
    await fixture.close()
  })

  const discovered = await client.request('server/discover')
  const discovery = discovered.result as Record<string, unknown>
  assert.deepEqual(discovery.supportedVersions, ['2026-07-28'])
  assert.equal(discovery.resultType, 'complete')

  const listed = await client.request('tools/list')
  const tools = (listed.result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name)
  assert.deepEqual(tools, ['page_open', 'page_capture', 'page_read', 'page_extract', 'page_find', 'page_close'])

  const opened = await client.tool('page_open', { url: `${fixture.origin}/listing.html` })
  const handle = opened.handle_id as string
  const captured = await client.tool('page_capture', { handle_id: handle })
  const snapshot = captured.snapshot_id as string
  const first = await client.tool('page_read', {
    snapshot_id: snapshot,
    format: 'markdown',
    extraction: 'document',
    max_bytes: 256,
  })
  assert.equal(typeof first.content, 'string')
  assert.equal(typeof first.next_cursor, 'string')
  const second = await client.tool('page_read', {
    snapshot_id: snapshot,
    format: 'markdown',
    extraction: 'document',
    max_bytes: 256,
    cursor: first.next_cursor,
  })
  assert.notEqual(first.content, second.content)

  const extracted = await client.tool('page_extract', {
    snapshot_id: snapshot,
    container: '.story',
    fields: [
      { name: 'title', selector: '.title', required: true },
      { name: 'url', selector: '.title', source: 'attribute', attribute: 'href', required: true },
    ],
    limit: 2,
  })
  assert.equal((extracted.records as unknown[]).length, 2)
  assert.equal(typeof extracted.next_cursor, 'string')
  const extractedTail = await client.tool('page_extract', {
    snapshot_id: snapshot,
    container: '.story',
    fields: [
      { name: 'title', selector: '.title', required: true },
      { name: 'url', selector: '.title', source: 'attribute', attribute: 'href', required: true },
    ],
    cursor: extracted.next_cursor,
    limit: 2,
  })
  assert.equal((extractedTail.records as unknown[]).length, 1)
  assert.equal(extractedTail.next_cursor, null)

  const found = await client.tool('page_find', { snapshot_id: snapshot, query: 'Beta ships' })
  assert.equal((found.matches as unknown[]).length, 1)
  assert.equal((await client.tool('page_close', { handle_id: handle })).closed, true)

  const afterClose = await client.tool('page_read', { snapshot_id: snapshot, format: 'text' })
  assert.match(afterClose.content as string, /Alpha launch/)
})
