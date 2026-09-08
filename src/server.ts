import { createRequire } from 'node:module'
import { fromJsonSchema, McpServer, type ServerContext } from '@modelcontextprotocol/server'
import type { ServerConfig } from './config.js'
import { BrowserManager } from './browser.js'
import { representation, type ContentFormat, type ExtractionMode } from './content.js'
import { extractRecords, type ExtractionSpec } from './extraction.js'
import { findPassages } from './find.js'
import { CursorCodec, digest } from './ids.js'
import { boundedArrayPage, cursorOffset, textPage, type CursorScope } from './pagination.js'
import { publicError, PtcWebError } from './errors.js'
import { SnapshotStore, snapshotMetadata } from './snapshots.js'

const manifest = createRequire(import.meta.url)('../../package.json') as { name: string; version: string }
const IDENTITY = { name: manifest.name, version: manifest.version } as const
const PRIVATE_META = { 'io.modelcontextprotocol/cacheScope': 'private' }
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true }
const PAGE_OPEN_OUTPUT = fromJsonSchema({
  type: 'object',
  properties: {
    handle_id: { type: 'string' },
    url: { type: 'string' },
    title: { type: 'string' },
    readiness: { type: 'string' },
    blocked_subrequests: { type: 'integer', minimum: 0 },
  },
  required: ['handle_id', 'url', 'title', 'readiness', 'blocked_subrequests'],
  additionalProperties: false,
})
const CAPTURE_OUTPUT = fromJsonSchema({
  type: 'object',
  properties: {
    snapshot_id: { type: 'string' },
    source_handle_id: { type: 'string' },
    url: { type: 'string' },
    title: { type: 'string' },
    captured_at: { type: 'string' },
    expires_at: { type: 'string' },
    extractor_version: { type: 'string' },
    content_hash: { type: 'string' },
    capture: { type: 'object', additionalProperties: true },
    coverage: { type: 'object', additionalProperties: true },
    preview: { type: 'string' },
  },
  required: [
    'snapshot_id',
    'source_handle_id',
    'url',
    'title',
    'captured_at',
    'expires_at',
    'extractor_version',
    'content_hash',
    'capture',
    'coverage',
    'preview',
  ],
  additionalProperties: false,
})
const READ_OUTPUT = fromJsonSchema({
  type: 'object',
  properties: {
    snapshot_id: { type: 'string' },
    source_handle_id: { type: 'string' },
    url: { type: 'string' },
    title: { type: 'string' },
    captured_at: { type: 'string' },
    expires_at: { type: 'string' },
    extractor_version: { type: 'string' },
    content_hash: { type: 'string' },
    capture: { type: 'object', additionalProperties: true },
    coverage: { type: 'object', additionalProperties: true },
    format: { type: 'string' },
    extraction: { type: 'string' },
    content: { type: 'string' },
    representation_hash: { type: 'string' },
  },
  required: [
    'snapshot_id',
    'source_handle_id',
    'url',
    'title',
    'captured_at',
    'expires_at',
    'extractor_version',
    'content_hash',
    'capture',
    'coverage',
    'format',
    'extraction',
    'content',
    'representation_hash',
  ],
  additionalProperties: true,
})
const EXTRACT_OUTPUT = fromJsonSchema({
  type: 'object',
  properties: {
    snapshot_id: { type: 'string' },
    records: { type: 'array', items: { type: 'object', additionalProperties: true } },
    matched_containers: { type: 'integer' },
    omitted_records: { type: 'integer' },
    result_truncated: { type: 'boolean' },
    recipe_hash: { type: 'string' },
  },
  required: ['snapshot_id', 'records', 'matched_containers', 'omitted_records', 'result_truncated', 'recipe_hash'],
  additionalProperties: true,
})
const FIND_OUTPUT = fromJsonSchema({
  type: 'object',
  properties: {
    snapshot_id: { type: 'string' },
    query: { type: 'string' },
    matches: { type: 'array', items: { type: 'object', additionalProperties: true } },
    result_truncated: { type: 'boolean' },
  },
  required: ['snapshot_id', 'query', 'matches', 'result_truncated'],
  additionalProperties: true,
})
const CLOSE_OUTPUT = fromJsonSchema({
  type: 'object',
  properties: {
    handle_id: { type: 'string' },
    closed: { type: 'boolean' },
    snapshots_retained_until_expiry: { type: 'boolean' },
  },
  required: ['handle_id', 'closed', 'snapshots_retained_until_expiry'],
  additionalProperties: false,
})

export class PtcWebRuntime {
  readonly browser: BrowserManager
  readonly snapshots: SnapshotStore
  readonly cursors = new CursorCodec()

  constructor(readonly config: ServerConfig) {
    this.browser = new BrowserManager(config)
    this.snapshots = new SnapshotStore(config.limits.snapshotTtlMs, config.limits.maxSnapshots)
  }

  async close(): Promise<void> {
    this.snapshots.clear()
    await this.browser.close()
  }
}

export function createServer(runtime: PtcWebRuntime): McpServer {
  const server = new McpServer(IDENTITY, {
    instructions:
      'Open public HTTP(S) pages, capture immutable bounded DOM snapshots, then read Markdown or extract selector-based records. Follow next_cursor until null. A complete snapshot read does not imply that a site loaded all available content.',
  })

  server.registerTool(
    'page_open',
    {
      title: 'Open page',
      description: 'Open a public HTTP(S) URL with a bounded readiness condition and return a page handle.',
      annotations: READ_ONLY,
      _meta: PRIVATE_META,
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          url: { type: 'string', minLength: 1 },
          wait_until: { type: 'string', enum: ['commit', 'domcontentloaded', 'load', 'networkidle'] },
          wait_for_selector: { type: 'string', minLength: 1, maxLength: 512 },
          timeout_ms: { type: 'integer', minimum: 1 },
        },
        required: ['url'],
        additionalProperties: false,
      }),
      outputSchema: PAGE_OPEN_OUTPUT,
    },
    async (rawArgs, ctx) =>
      safe(async () => {
        const args = objectArgs(rawArgs)
        const opened = await runtime.browser.open({
          url: requireString(args.url, 'url'),
          ...(args.wait_until === undefined
            ? {}
            : { waitUntil: args.wait_until as 'commit' | 'domcontentloaded' | 'load' | 'networkidle' }),
          ...(args.wait_for_selector === undefined
            ? {}
            : { waitForSelector: requireString(args.wait_for_selector, 'wait_for_selector') }),
          ...(args.timeout_ms === undefined ? {} : { timeoutMs: requireInteger(args.timeout_ms, 'timeout_ms') }),
          signal: ctx.mcpReq.signal,
        })
        return boundedStructured(runtime, {
          handle_id: opened.handleId,
          url: opened.url,
          title: opened.title,
          readiness: 'ready',
          blocked_subrequests: opened.blockedRequests,
        })
      }),
  )

  server.registerTool(
    'page_capture',
    {
      title: 'Capture page',
      description: 'Create an immutable, expiring, bounded DOM snapshot and return metadata plus a small preview.',
      annotations: READ_ONLY,
      _meta: PRIVATE_META,
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: { handle_id: { type: 'string', minLength: 1 } },
        required: ['handle_id'],
        additionalProperties: false,
      }),
      outputSchema: CAPTURE_OUTPUT,
    },
    async (rawArgs, ctx) =>
      safe(async () => {
        const args = objectArgs(rawArgs)
        const capture = await runtime.browser.capture(requireString(args.handle_id, 'handle_id'), ctx.mcpReq.signal)
        const snapshot = runtime.snapshots.create(capture)
        const preview = representation(snapshot, 'text', 'document').content.slice(0, 1_000)
        return boundedStructured(runtime, { ...snapshotMetadata(snapshot), preview })
      }),
  )

  server.registerTool(
    'page_read',
    {
      title: 'Read snapshot',
      description: 'Read bounded Markdown or plain text from one immutable snapshot. Follow next_cursor until null.',
      annotations: { ...READ_ONLY, idempotentHint: true },
      _meta: PRIVATE_META,
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          snapshot_id: { type: 'string', minLength: 1 },
          format: { type: 'string', enum: ['markdown', 'text'] },
          extraction: { type: 'string', enum: ['article', 'document'] },
          cursor: { type: 'string', minLength: 1 },
          max_bytes: { type: 'integer', minimum: 256 },
        },
        required: ['snapshot_id'],
        additionalProperties: false,
      }),
      outputSchema: READ_OUTPUT,
    },
    async (rawArgs) =>
      safe(async () => {
        const args = objectArgs(rawArgs)
        const snapshot = runtime.snapshots.get(requireString(args.snapshot_id, 'snapshot_id'))
        const format = (args.format ?? 'markdown') as ContentFormat
        const extraction = (args.extraction ?? 'document') as ExtractionMode
        const rendered = representation(snapshot, format, extraction)
        const representationHash = digest(rendered.content)
        const scope: CursorScope = {
          snapshot: snapshot.id,
          operation: 'page_read',
          scope: `${format}:${extraction}:${representationHash}`,
        }
        const offset = cursorOffset(runtime.cursors, optionalString(args.cursor, 'cursor'), scope)
        const ceiling = Math.max(256, runtime.config.limits.maxResponseBytes - 4_096)
        const requested =
          args.max_bytes === undefined ? ceiling : Math.min(requireInteger(args.max_bytes, 'max_bytes'), ceiling)
        let pageBytes = requested
        while (pageBytes > 0) {
          const page = textPage(rendered.content, offset, pageBytes)
          const nextCursor =
            page.nextOffset === null ? null : runtime.cursors.encode({ ...scope, offset: page.nextOffset })
          const value = {
            ...snapshotMetadata(snapshot),
            format,
            extraction,
            content: page.content,
            representation_hash: representationHash,
            byline: rendered.byline,
            excerpt: rendered.excerpt,
            next_cursor: nextCursor,
          }
          if (logicalResultBytes(value) <= runtime.config.limits.maxResponseBytes) return structured(value)
          pageBytes = Math.floor(pageBytes * 0.75)
        }
        throw new PtcWebError('resource_limit_exceeded', 'snapshot metadata exceeds the response byte limit')
      }),
  )

  server.registerTool(
    'page_extract',
    {
      title: 'Extract records',
      description: 'Extract records from an immutable snapshot with declarative CSS container and field selectors.',
      annotations: { ...READ_ONLY, idempotentHint: true },
      _meta: PRIVATE_META,
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          snapshot_id: { type: 'string', minLength: 1 },
          container: { type: 'string', minLength: 1, maxLength: 512 },
          fields: {
            type: 'array',
            minItems: 1,
            maxItems: 64,
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', minLength: 1, maxLength: 64 },
                selector: { type: 'string', maxLength: 512 },
                source: { type: 'string', enum: ['text', 'html', 'attribute'] },
                attribute: { type: 'string', minLength: 1, maxLength: 128 },
                multiple: { type: 'boolean' },
                required: { type: 'boolean' },
              },
              required: ['name'],
              additionalProperties: false,
            },
          },
          cursor: { type: 'string', minLength: 1 },
          limit: { type: 'integer', minimum: 1 },
        },
        required: ['snapshot_id', 'container', 'fields'],
        additionalProperties: false,
      }),
      outputSchema: EXTRACT_OUTPUT,
    },
    async (rawArgs, ctx) =>
      safe(async () => {
        const args = objectArgs(rawArgs)
        throwIfAborted(ctx)
        const snapshot = runtime.snapshots.get(requireString(args.snapshot_id, 'snapshot_id'))
        const spec: ExtractionSpec = {
          container: requireString(args.container, 'container'),
          fields: args.fields as ExtractionSpec['fields'],
        }
        const extracted = extractRecords(snapshot, spec, runtime.config.limits.maxExtractRecords)
        throwIfAborted(ctx)
        const scope: CursorScope = { snapshot: snapshot.id, operation: 'page_extract', scope: extracted.specHash }
        const offset = cursorOffset(runtime.cursors, optionalString(args.cursor, 'cursor'), scope)
        const limit = Math.min(args.limit === undefined ? 100 : requireInteger(args.limit, 'limit'), 200)
        const base = {
          ...snapshotMetadata(snapshot),
          matched_containers: extracted.matchedContainers,
          omitted_records: extracted.omittedRecords,
          result_truncated: extracted.resultTruncated,
          recipe_hash: extracted.specHash,
        }
        const page = boundedArrayPage(
          extracted.records,
          offset,
          limit,
          runtime.config.limits.maxResponseBytes,
          (records, next) =>
            wireEnvelope({
              ...base,
              records,
              next_cursor: next === null ? null : runtime.cursors.encode({ ...scope, offset: next }),
            }),
        )
        return boundedStructured(runtime, {
          ...base,
          records: page.items,
          next_cursor:
            page.nextOffset === null ? null : runtime.cursors.encode({ ...scope, offset: page.nextOffset }),
        })
      }),
  )

  server.registerTool(
    'page_find',
    {
      title: 'Find in snapshot',
      description: 'Find literal passages in a snapshot representation. Follow next_cursor until null.',
      annotations: { ...READ_ONLY, idempotentHint: true },
      _meta: PRIVATE_META,
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          snapshot_id: { type: 'string', minLength: 1 },
          query: { type: 'string', minLength: 1, maxLength: 512 },
          format: { type: 'string', enum: ['markdown', 'text'] },
          extraction: { type: 'string', enum: ['article', 'document'] },
          cursor: { type: 'string', minLength: 1 },
          limit: { type: 'integer', minimum: 1 },
        },
        required: ['snapshot_id', 'query'],
        additionalProperties: false,
      }),
      outputSchema: FIND_OUTPUT,
    },
    async (rawArgs) =>
      safe(async () => {
        const args = objectArgs(rawArgs)
        const snapshot = runtime.snapshots.get(requireString(args.snapshot_id, 'snapshot_id'))
        const query = requireString(args.query, 'query')
        const format = (args.format ?? 'text') as ContentFormat
        const extraction = (args.extraction ?? 'document') as ExtractionMode
        const rendered = representation(snapshot, format, extraction)
        const found = findPassages(rendered.content, query, runtime.config.limits.maxFindMatches)
        const findScope = digest(
          JSON.stringify({ query, format, extraction, representation: digest(rendered.content) }),
        )
        const scope: CursorScope = { snapshot: snapshot.id, operation: 'page_find', scope: findScope }
        const offset = cursorOffset(runtime.cursors, optionalString(args.cursor, 'cursor'), scope)
        const limit = Math.min(args.limit === undefined ? 50 : requireInteger(args.limit, 'limit'), 100)
        const base = { ...snapshotMetadata(snapshot), query, format, extraction, result_truncated: found.truncated }
        const page = boundedArrayPage(
          found.matches,
          offset,
          limit,
          runtime.config.limits.maxResponseBytes,
          (matches, next) =>
            wireEnvelope({
              ...base,
              matches,
              next_cursor: next === null ? null : runtime.cursors.encode({ ...scope, offset: next }),
            }),
        )
        return boundedStructured(runtime, {
          ...base,
          matches: page.items,
          next_cursor:
            page.nextOffset === null ? null : runtime.cursors.encode({ ...scope, offset: page.nextOffset }),
        })
      }),
  )

  server.registerTool(
    'page_close',
    {
      title: 'Close page',
      description: 'Release one page handle. Existing immutable snapshots remain readable until expiry.',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: PRIVATE_META,
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: { handle_id: { type: 'string', minLength: 1 } },
        required: ['handle_id'],
        additionalProperties: false,
      }),
      outputSchema: CLOSE_OUTPUT,
    },
    async (rawArgs) =>
      safe(async () => {
        const args = objectArgs(rawArgs)
        return boundedStructured(runtime, {
          handle_id: requireString(args.handle_id, 'handle_id'),
          closed: await runtime.browser.closePage(requireString(args.handle_id, 'handle_id')),
          snapshots_retained_until_expiry: true,
        })
      }),
  )

  return server
}

function structured(value: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], structuredContent: value }
}

function wireEnvelope(value: Record<string, unknown>): Record<string, unknown> {
  return {
    ...structured(value),
    resultType: 'complete',
    _meta: { 'io.modelcontextprotocol/serverInfo': IDENTITY },
  }
}

function logicalResultBytes(value: Record<string, unknown>): number {
  return Buffer.byteLength(JSON.stringify(wireEnvelope(value)), 'utf8')
}

function boundedStructured(runtime: PtcWebRuntime, value: Record<string, unknown>): ReturnType<typeof structured> {
  if (logicalResultBytes(value) > runtime.config.limits.maxResponseBytes) {
    throw new PtcWebError('resource_limit_exceeded', 'tool result exceeds the response byte limit')
  }
  return structured(value)
}

async function safe(
  operation: () => Promise<ReturnType<typeof structured>>,
): Promise<ReturnType<typeof structured> & { isError?: boolean }> {
  try {
    return await operation()
  } catch (error) {
    const exposed = publicError(error)
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: exposed }) }],
      isError: true,
    } as ReturnType<typeof structured> & { isError: true }
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '')
    throw new PtcWebError('invalid_request', `${field} must be a non-empty string`)
  return value
}

function objectArgs(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new PtcWebError('invalid_request', 'arguments must be an object')
  return value as Record<string, unknown>
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  return requireString(value, field)
}

function requireInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new PtcWebError('invalid_request', `${field} must be a positive integer`)
  return value
}

function throwIfAborted(ctx: ServerContext): void {
  if (ctx.mcpReq.signal.aborted) throw new DOMException('operation cancelled', 'AbortError')
}

export { IDENTITY }
