import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { BrowserManager } from '../../src/browser.js'
import { DEFAULT_LIMITS, type ServerConfig } from '../../src/config.js'
import { representation } from '../../src/content.js'
import { extractRecords } from '../../src/extraction.js'
import { SnapshotStore } from '../../src/snapshots.js'
import { startFixtureServer } from '../support/fixture-server.js'

test('captures article, documentation, listing, discussion, and dynamic fixtures', async (t) => {
  const fixture = await startFixtureServer()
  const browser = new BrowserManager(config(fixture.origin))
  const snapshots = new SnapshotStore(30_000, 16)
  t.after(async () => {
    await browser.close()
    await fixture.close()
  })

  const article = await capture(browser, snapshots, `${fixture.origin}/article.html`)
  const markdown = representation(article, 'markdown', 'article').content
  assert.match(markdown, /# Harbor restoration succeeds/)
  assert.match(markdown, /forty-two/)
  assert.match(markdown, /Native reeds returned/)
  assert.match(markdown, new RegExp(`${fixture.origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/report`))

  const documentation = await capture(browser, snapshots, `${fixture.origin}/documentation.html`)
  const docsMarkdown = representation(documentation, 'markdown', 'document').content
  assert.match(docsMarkdown, /```/)
  assert.match(docsMarkdown, /\| Field\s+\| Type/)
  assert.match(docsMarkdown, /BAD_COLOR/)

  const listing = await capture(browser, snapshots, `${fixture.origin}/listing.html`)
  assert.equal(
    extractRecords(listing, { container: '.story', fields: [{ name: 'title', selector: '.title' }] }, 20).records
      .length,
    3,
  )

  const discussion = await capture(browser, snapshots, `${fixture.origin}/discussion.html`)
  const comments = extractRecords(
    discussion,
    {
      container: '.comment',
      fields: [
        { name: 'id', source: 'attribute', attribute: 'data-id' },
        { name: 'parent', source: 'attribute', attribute: 'data-parent' },
      ],
    },
    20,
  ).records
  assert.deepEqual(
    comments.map((record) => [record.id, record.parent]),
    [
      ['c1', 'p1'],
      ['c2', 'c1'],
      ['c3', 'p1'],
    ],
  )

  const dynamic = await capture(browser, snapshots, `${fixture.origin}/dynamic.html`, '#ready:not([hidden])')
  assert.deepEqual(extractRecords(dynamic, { container: '.item', fields: [{ name: 'name' }] }, 20).records, [
    { name: 'Compass' },
    { name: 'Lantern' },
  ])
})

test('enforces capture/page limits and releases resources on close', async (t) => {
  const fixture = await startFixtureServer()
  const limits = { ...DEFAULT_LIMITS, maxCaptureBytes: 512, maxPages: 1 }
  const browser = new BrowserManager({ ...config(fixture.origin), limits })
  t.after(async () => {
    await browser.close()
    await fixture.close()
  })
  const opened = await browser.open({ url: `${fixture.origin}/oversize` })
  await assert.rejects(browser.open({ url: `${fixture.origin}/article.html` }), /open page limit/)
  const captured = await browser.capture(opened.handleId)
  assert.equal(captured.truncated, true)
  assert.ok(captured.capturedBytes <= 512)
  assert.equal(await browser.closePage(opened.handleId), true)
  assert.equal(browser.openPageCount, 0)
})

test('enforces network response and per-page request limits', async (t) => {
  const fixture = await startFixtureServer()
  const resourceBrowser = new BrowserManager({
    ...config(fixture.origin),
    limits: { ...DEFAULT_LIMITS, maxResourceBytes: 1_024 },
  })
  const requestBrowser = new BrowserManager({
    ...config(fixture.origin),
    limits: { ...DEFAULT_LIMITS, maxRequestsPerPage: 1 },
  })
  t.after(async () => {
    await resourceBrowser.close()
    await requestBrowser.close()
    await fixture.close()
  })
  await assert.rejects(resourceBrowser.open({ url: `${fixture.origin}/oversize` }), /resource byte limit/)
  const opened = await requestBrowser.open({ url: `${fixture.origin}/dynamic.html`, waitUntil: 'load' })
  await new Promise((resolve) => setTimeout(resolve, 100))
  const captured = await requestBrowser.capture(opened.handleId)
  assert.ok(captured.blockedRequests >= 1)
  assert.ok(captured.networkRequests > 1)
})

test('blocks unconfigured local redirects and subrequests before they reach the destination', async (t) => {
  let hits = 0
  const forbidden = createServer((_request, response) => {
    hits += 1
    response.end('private')
  })
  await new Promise<void>((resolve) => forbidden.listen(0, '127.0.0.1', resolve))
  const address = forbidden.address()
  if (address === null || typeof address === 'string') throw new Error('forbidden server failed to bind')
  const forbiddenUrl = `http://127.0.0.1:${address.port}/secret`
  const fixture = await startFixtureServer()
  const browser = new BrowserManager(config(fixture.origin))
  t.after(async () => {
    await browser.close()
    await fixture.close()
    await new Promise<void>((resolve) => forbidden.close(() => resolve()))
  })

  const allowedRedirect = await browser.open({ url: `${fixture.origin}/redirect?to=/article.html` })
  assert.equal(allowedRedirect.url, `${fixture.origin}/article.html`)
  await browser.closePage(allowedRedirect.handleId)
  await assert.rejects(
    browser.open({ url: `${fixture.origin}/redirect?to=${encodeURIComponent(forbiddenUrl)}` }),
    /non-public address/,
  )
  const page = await browser.open({ url: `${fixture.origin}/subrequest?target=${encodeURIComponent(forbiddenUrl)}` })
  const captured = await browser.capture(page.handleId)
  assert.equal(captured.blockedRequests, 1)
  assert.equal(hits, 0)
})

test('cancellation closes an in-flight page handle', async (t) => {
  const fixture = await startFixtureServer()
  const browser = new BrowserManager(config(fixture.origin))
  t.after(async () => {
    await browser.close()
    await fixture.close()
  })
  const controller = new AbortController()
  const opening = browser.open({ url: `${fixture.origin}/slow`, signal: controller.signal, timeoutMs: 5_000 })
  setTimeout(() => controller.abort(), 50)
  await assert.rejects(opening, /cancelled/)
  assert.equal(browser.openPageCount, 0)
})

async function capture(browser: BrowserManager, snapshots: SnapshotStore, url: string, waitForSelector?: string) {
  const opened = await browser.open({ url, ...(waitForSelector === undefined ? {} : { waitForSelector }) })
  const data = await browser.capture(opened.handleId)
  await browser.closePage(opened.handleId)
  return snapshots.create(data)
}

function config(origin: string): ServerConfig {
  return { limits: { ...DEFAULT_LIMITS }, localOrigins: new Set([origin]), headless: true }
}
