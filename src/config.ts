import { resolve } from 'node:path'
import { PtcWebError } from './errors.js'

export interface Limits {
  maxCaptureBytes: number
  maxResourceBytes: number
  maxRequestsPerPage: number
  maxResponseBytes: number
  maxSnapshots: number
  maxPages: number
  maxExtractRecords: number
  maxFindMatches: number
  navigationTimeoutMs: number
  snapshotTtlMs: number
}

export interface ServerConfig {
  limits: Limits
  localOrigins: ReadonlySet<string>
  profileDir?: string
  headless: boolean
}

export const DEFAULT_LIMITS: Limits = {
  maxCaptureBytes: 2 * 1024 * 1024,
  maxResourceBytes: 8 * 1024 * 1024,
  maxRequestsPerPage: 256,
  maxResponseBytes: 48_000,
  maxSnapshots: 32,
  maxPages: 8,
  maxExtractRecords: 500,
  maxFindMatches: 200,
  navigationTimeoutMs: 15_000,
  snapshotTtlMs: 5 * 60_000,
}

const LIMIT_ENV: ReadonlyArray<[keyof Limits, string]> = [
  ['maxCaptureBytes', 'PTC_WEB_MAX_CAPTURE_BYTES'],
  ['maxResourceBytes', 'PTC_WEB_MAX_RESOURCE_BYTES'],
  ['maxRequestsPerPage', 'PTC_WEB_MAX_REQUESTS_PER_PAGE'],
  ['maxResponseBytes', 'PTC_WEB_MAX_RESPONSE_BYTES'],
  ['maxSnapshots', 'PTC_WEB_MAX_SNAPSHOTS'],
  ['maxPages', 'PTC_WEB_MAX_PAGES'],
  ['maxExtractRecords', 'PTC_WEB_MAX_EXTRACT_RECORDS'],
  ['maxFindMatches', 'PTC_WEB_MAX_FIND_MATCHES'],
  ['navigationTimeoutMs', 'PTC_WEB_NAVIGATION_TIMEOUT_MS'],
  ['snapshotTtlMs', 'PTC_WEB_SNAPSHOT_TTL_MS'],
]

function positiveInteger(value: string, name: string): number {
  if (!/^[1-9][0-9]*$/.test(value)) throw new PtcWebError('invalid_request', `${name} must be a positive integer`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw new PtcWebError('invalid_request', `${name} is too large`)
  return parsed
}

export function configFromEnvironment(environment: NodeJS.ProcessEnv = process.env): ServerConfig {
  const limits = { ...DEFAULT_LIMITS }
  for (const [key, name] of LIMIT_ENV) {
    const value = environment[name]
    if (value !== undefined) limits[key] = positiveInteger(value, name)
  }
  if (limits.maxResponseBytes < 8_192) {
    throw new PtcWebError('invalid_request', 'PTC_WEB_MAX_RESPONSE_BYTES must be at least 8192')
  }
  const rawOrigins =
    environment.PTC_WEB_ALLOW_LOCAL_ORIGINS?.split(',')
      .map((item) => item.trim())
      .filter(Boolean) ?? []
  const localOrigins = new Set(rawOrigins.map(normalizeOrigin))
  const profileDir = environment.PTC_WEB_PROFILE_DIR
  return {
    limits,
    localOrigins,
    ...(profileDir === undefined || profileDir === '' ? {} : { profileDir: resolve(profileDir) }),
    headless: environment.PTC_WEB_HEADLESS !== 'false',
  }
}

export function normalizeOrigin(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new PtcWebError('invalid_request', `invalid allowed origin: ${value}`)
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new PtcWebError('invalid_request', `allowed origin must be an HTTP(S) origin: ${value}`)
  }
  return url.origin
}
