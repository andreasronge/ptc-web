import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type BrowserContext, type CDPSession, type Page } from 'playwright'
import type { ServerConfig } from './config.js'
import { AccessPolicy, isNonNetworkUrl } from './access-policy.js'
import { PtcWebError } from './errors.js'
import { newId } from './ids.js'

export type Readiness = 'commit' | 'domcontentloaded' | 'load' | 'networkidle'

export interface OpenOptions {
  url: string
  waitUntil?: Readiness
  waitForSelector?: string
  timeoutMs?: number
  signal?: AbortSignal
}

export interface PageHandle {
  id: string
  page: Page
  openedAt: string
  blockedRequests: number
  blockedNavigation: boolean
  networkRequests: number
  lastBlockedReason?: string
  lastBlockedCode: 'access_denied' | 'blocked' | 'resource_limit_exceeded' | 'unavailable' | undefined
  cdp: CDPSession
}

export interface PageCapture {
  handleId: string
  url: string
  title: string
  html: string
  capturedBytes: number
  sourceBytes: number
  truncated: boolean
  blockedRequests: number
  networkRequests: number
  captureLimitBytes: number
}

export class BrowserManager {
  private context: BrowserContext | undefined
  private temporaryProfile: string | undefined
  private readonly pages = new Map<string, PageHandle>()
  private readonly policy: AccessPolicy

  constructor(private readonly config: ServerConfig) {
    this.policy = new AccessPolicy(config.localOrigins)
  }

  async open(
    options: OpenOptions,
  ): Promise<{ handleId: string; url: string; title: string; blockedRequests: number }> {
    await this.policy.assertAllowed(options.url)
    if (this.pages.size >= this.config.limits.maxPages)
      throw new PtcWebError('resource_limit_exceeded', 'open page limit reached')
    const context = await this.ensureContext()
    const page = await context.newPage()
    const cdp = await context.newCDPSession(page)
    const handle: PageHandle = {
      id: newId('p'),
      page,
      openedAt: new Date().toISOString(),
      blockedRequests: 0,
      blockedNavigation: false,
      networkRequests: 0,
      lastBlockedCode: undefined,
      cdp,
    }
    this.pages.set(handle.id, handle)
    page.once('close', () => this.pages.delete(handle.id))
    cdp.on('Fetch.requestPaused', (event: unknown) => {
      void this.guardRequest(handle, event as PausedRequest)
    })
    await cdp.send('Fetch.enable', {
      patterns: [
        { urlPattern: '*', requestStage: 'Request' },
        { urlPattern: '*', requestStage: 'Response' },
      ],
    })

    const timeout = Math.min(
      options.timeoutMs ?? this.config.limits.navigationTimeoutMs,
      this.config.limits.navigationTimeoutMs,
    )
    try {
      await cancellablePageOperation(page, options.signal, async () => {
        await page.goto(options.url, { waitUntil: options.waitUntil ?? 'domcontentloaded', timeout })
        if (options.waitForSelector !== undefined)
          await page.waitForSelector(options.waitForSelector, { timeout, state: 'attached' })
      })
      if (handle.blockedNavigation) {
        throw new PtcWebError(
          handle.lastBlockedCode ?? 'access_denied',
          handle.lastBlockedReason ?? 'navigation was blocked by access policy',
        )
      }
      return {
        handleId: handle.id,
        url: page.url(),
        title: await page.title(),
        blockedRequests: handle.blockedRequests,
      }
    } catch (error) {
      await page.close().catch(() => undefined)
      if (error instanceof PtcWebError) throw error
      if (options.signal?.aborted) throw aborted()
      if (handle.blockedNavigation) {
        throw new PtcWebError(
          handle.lastBlockedCode ?? 'access_denied',
          handle.lastBlockedReason ?? 'navigation was blocked',
        )
      }
      throw new PtcWebError('unavailable', `page could not be opened: ${safePlaywrightMessage(error)}`)
    }
  }

  async capture(handleId: string, signal?: AbortSignal): Promise<PageCapture> {
    const handle = this.requirePage(handleId)
    const [html, title] = await abortable(Promise.all([handle.page.content(), handle.page.title()]), signal)
    const sourceBytes = Buffer.byteLength(html, 'utf8')
    const bounded = truncateUtf8(html, this.config.limits.maxCaptureBytes)
    return {
      handleId,
      url: handle.page.url(),
      title,
      html: bounded.text,
      capturedBytes: bounded.bytes,
      sourceBytes,
      truncated: bounded.truncated,
      blockedRequests: handle.blockedRequests,
      networkRequests: handle.networkRequests,
      captureLimitBytes: this.config.limits.maxCaptureBytes,
    }
  }

  async closePage(handleId: string): Promise<boolean> {
    const handle = this.pages.get(handleId)
    if (handle === undefined) return false
    this.pages.delete(handleId)
    await handle.page.close().catch(() => undefined)
    return true
  }

  hasPage(handleId: string): boolean {
    return this.pages.has(handleId)
  }

  get openPageCount(): number {
    return this.pages.size
  }

  async close(): Promise<void> {
    this.pages.clear()
    const context = this.context
    this.context = undefined
    if (context !== undefined) await context.close().catch(() => undefined)
    if (this.temporaryProfile !== undefined) {
      const profile = this.temporaryProfile
      this.temporaryProfile = undefined
      await rm(profile, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private requirePage(handleId: string): PageHandle {
    const handle = this.pages.get(handleId)
    if (handle === undefined || handle.page.isClosed())
      throw new PtcWebError('not_found', 'page handle is unavailable')
    return handle
  }

  private async ensureContext(): Promise<BrowserContext> {
    if (this.context !== undefined) return this.context
    const profile = this.config.profileDir ?? (await mkdtemp(join(tmpdir(), 'ptc-web-')))
    if (this.config.profileDir === undefined) this.temporaryProfile = profile
    this.context = await chromium.launchPersistentContext(profile, {
      headless: this.config.headless,
      serviceWorkers: 'block',
    })
    return this.context
  }

  private async guardRequest(handle: PageHandle, event: PausedRequest): Promise<void> {
    try {
      if (event.responseStatusCode === undefined) {
        if (isNonNetworkUrl(event.request.url)) {
          await handle.cdp.send('Fetch.continueRequest', { requestId: event.requestId })
          return
        }
        handle.networkRequests += 1
        if (handle.networkRequests > this.config.limits.maxRequestsPerPage) {
          throw new PtcWebError('resource_limit_exceeded', 'page request limit exceeded')
        }
        await this.policy.assertAllowed(event.request.url)
        await handle.cdp.send('Fetch.continueRequest', { requestId: event.requestId })
        return
      }
      const contentLength = event.responseHeaders?.find(
        (header) => header.name.toLowerCase() === 'content-length',
      )?.value
      if (contentLength !== undefined && Number(contentLength) > this.config.limits.maxResourceBytes) {
        throw new PtcWebError('resource_limit_exceeded', 'network response exceeds the resource byte limit')
      }
      if (event.responseStatusCode >= 300 && event.responseStatusCode < 400) {
        // Redirect bodies are never useful to the browser-content contract.
        // Re-emit only the status and headers so an unbounded chunked redirect
        // body cannot bypass the per-resource ceiling.
        await handle.cdp.send('Fetch.fulfillRequest', {
          requestId: event.requestId,
          responseCode: event.responseStatusCode,
          responseHeaders: event.responseHeaders ?? [],
          body: '',
        })
        return
      }
      if (event.responseStatusCode === 204 || event.request.method === 'HEAD') {
        await handle.cdp.send('Fetch.continueResponse', { requestId: event.requestId })
        return
      }
      const response = (await handle.cdp.send('Fetch.getResponseBody', { requestId: event.requestId })) as {
        body: string
        base64Encoded: boolean
      }
      const body = Buffer.from(response.body, response.base64Encoded ? 'base64' : 'utf8')
      if (body.byteLength > this.config.limits.maxResourceBytes) {
        throw new PtcWebError('resource_limit_exceeded', 'network response exceeds the resource byte limit')
      }
      await handle.cdp.send('Fetch.continueResponse', { requestId: event.requestId })
    } catch (error) {
      handle.blockedRequests += 1
      handle.lastBlockedReason = error instanceof Error ? error.message : 'request blocked by access policy'
      handle.lastBlockedCode =
        error instanceof PtcWebError ? (error.code as PageHandle['lastBlockedCode']) : 'unavailable'
      if (event.resourceType === 'Document') handle.blockedNavigation = true
      await handle.cdp
        .send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' })
        .catch(() => undefined)
    }
  }
}

interface PausedRequest {
  requestId: string
  request: { url: string; method: string }
  resourceType: string
  responseStatusCode?: number
  responseHeaders?: Array<{ name: string; value: string }>
}

export function truncateUtf8(value: string, maxBytes: number): { text: string; bytes: number; truncated: boolean } {
  const source = Buffer.from(value, 'utf8')
  if (source.byteLength <= maxBytes) return { text: value, bytes: source.byteLength, truncated: false }
  let end = maxBytes
  while (end > 0 && (source[end] ?? 0) >= 0x80 && (source[end] ?? 0) < 0xc0) end -= 1
  const text = source.subarray(0, end).toString('utf8')
  return { text, bytes: Buffer.byteLength(text, 'utf8'), truncated: true }
}

async function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return promise
  if (signal.aborted) throw aborted()
  return await new Promise<T>((resolve, reject) => {
    const listener = (): void => {
      reject(aborted())
    }
    signal.addEventListener('abort', listener, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', listener)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', listener)
        reject(error)
      },
    )
  })
}

async function cancellablePageOperation<T>(
  page: Page,
  signal: AbortSignal | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  if (signal === undefined) return await operation()
  if (signal.aborted) throw aborted()
  const listener = (): void => {
    void page.close().catch(() => undefined)
  }
  signal.addEventListener('abort', listener, { once: true })
  try {
    return await operation()
  } catch (error) {
    if (signal.aborted) throw aborted()
    throw error
  } finally {
    signal.removeEventListener('abort', listener)
  }
}

function aborted(): Error {
  return new DOMException('operation cancelled', 'AbortError')
}

function safePlaywrightMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'navigation failed'
  if (/Timeout/i.test(error.message)) return 'readiness condition timed out'
  if (/ERR_BLOCKED_BY_CLIENT/.test(error.message)) return 'destination was blocked by access policy'
  return 'navigation failed'
}
