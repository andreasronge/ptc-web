import { createRequire } from 'node:module'
import { PtcWebError } from './errors.js'
import { digest, newId } from './ids.js'
import type { Representation } from './content.js'

const manifest = createRequire(import.meta.url)('../../package.json') as { name: string; version: string }
const EXTRACTOR_VERSION = `${manifest.name}/${manifest.version}`

export interface Snapshot {
  id: string
  handleId: string
  url: string
  title: string
  html: string
  capturedAt: string
  expiresAt: string
  capturedBytes: number
  sourceBytes: number
  truncated: boolean
  blockedRequests: number
  networkRequests: number
  captureLimitBytes: number
  extractorVersion: string
  contentHash: string
  representations: Map<string, Representation>
}

export interface SnapshotInput
  extends Omit<
    Snapshot,
    'id' | 'capturedAt' | 'expiresAt' | 'extractorVersion' | 'contentHash' | 'representations'
  > {}

export class SnapshotStore {
  private readonly snapshots = new Map<string, Snapshot>()
  private readonly expired = new Map<string, number>()

  constructor(
    private readonly ttlMs: number,
    private readonly maximum: number,
    private readonly now: () => number = Date.now,
  ) {}

  create(input: SnapshotInput): Snapshot {
    this.cleanup()
    if (this.snapshots.size >= this.maximum)
      throw new PtcWebError('resource_limit_exceeded', 'snapshot limit reached')
    const created = this.now()
    const snapshot: Snapshot = {
      ...input,
      id: newId('s'),
      capturedAt: new Date(created).toISOString(),
      expiresAt: new Date(created + this.ttlMs).toISOString(),
      extractorVersion: EXTRACTOR_VERSION,
      contentHash: digest(input.html),
      representations: new Map(),
    }
    this.snapshots.set(snapshot.id, snapshot)
    return snapshot
  }

  get(id: string): Snapshot {
    const snapshot = this.snapshots.get(id)
    if (snapshot !== undefined) {
      if (Date.parse(snapshot.expiresAt) <= this.now()) {
        this.snapshots.delete(id)
        this.expired.set(id, this.now() + this.ttlMs)
        throw new PtcWebError('expired', 'snapshot has expired')
      }
      return snapshot
    }
    const tombstoneUntil = this.expired.get(id)
    if (tombstoneUntil !== undefined && tombstoneUntil > this.now())
      throw new PtcWebError('expired', 'snapshot has expired')
    throw new PtcWebError('not_found', 'snapshot is unavailable')
  }

  cleanup(): number {
    const now = this.now()
    let removed = 0
    for (const [id, snapshot] of this.snapshots) {
      if (Date.parse(snapshot.expiresAt) <= now) {
        this.snapshots.delete(id)
        this.expired.set(id, now + this.ttlMs)
        removed += 1
      }
    }
    for (const [id, until] of this.expired) if (until <= now) this.expired.delete(id)
    return removed
  }

  clear(): void {
    this.snapshots.clear()
    this.expired.clear()
  }

  get size(): number {
    return this.snapshots.size
  }
}

export function snapshotMetadata(snapshot: Snapshot): Record<string, unknown> {
  return {
    snapshot_id: snapshot.id,
    source_handle_id: snapshot.handleId,
    url: snapshot.url,
    title: snapshot.title,
    captured_at: snapshot.capturedAt,
    expires_at: snapshot.expiresAt,
    extractor_version: snapshot.extractorVersion,
    content_hash: snapshot.contentHash,
    capture: {
      captured_bytes: snapshot.capturedBytes,
      source_bytes: snapshot.sourceBytes,
      byte_limit: snapshot.captureLimitBytes,
    },
    coverage: {
      scope: 'captured_dom',
      truncated: snapshot.truncated,
      unloaded_content: 'unknown',
      blocked_subrequests: snapshot.blockedRequests,
      network_requests: snapshot.networkRequests,
    },
  }
}
