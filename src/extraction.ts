import { load, type Cheerio, type CheerioAPI } from 'cheerio'
import type { AnyNode } from 'domhandler'
import { digest } from './ids.js'
import { PtcWebError } from './errors.js'
import type { Snapshot } from './snapshots.js'

export type FieldSource = 'text' | 'html' | 'attribute'

export interface FieldSpec {
  name: string
  selector?: string
  source?: FieldSource
  attribute?: string
  multiple?: boolean
  required?: boolean
}

export interface ExtractionSpec {
  container: string
  fields: FieldSpec[]
}

export interface ExtractionResult {
  records: Array<Record<string, string | string[] | null>>
  matchedContainers: number
  omittedRecords: number
  resultTruncated: boolean
  specHash: string
}

export function extractRecords(snapshot: Snapshot, spec: ExtractionSpec, maximum: number): ExtractionResult {
  validateSpec(spec)
  const specHash = digest(stableJson(spec))
  const $ = load(snapshot.html, { baseURI: snapshot.url })
  let containers: Cheerio<AnyNode>
  try {
    containers = $(spec.container)
  } catch {
    throw new PtcWebError('invalid_request', 'container is not a valid CSS selector')
  }

  const records: ExtractionResult['records'] = []
  let omittedRecords = 0
  const matchedContainers = containers.length
  containers.slice(0, maximum).each((_index, node) => {
    const container = $(node)
    const record: Record<string, string | string[] | null> = {}
    let missingRequired = false
    for (const field of spec.fields) {
      const value = extractField($, container, field, snapshot.url)
      record[field.name] = value
      if (field.required === true && (value === null || value === '' || (Array.isArray(value) && value.length === 0)))
        missingRequired = true
    }
    if (missingRequired) omittedRecords += 1
    else records.push(record)
  })
  return {
    records,
    matchedContainers,
    omittedRecords,
    resultTruncated: matchedContainers > maximum,
    specHash,
  }
}

function extractField(
  $: CheerioAPI,
  container: Cheerio<AnyNode>,
  field: FieldSpec,
  baseUrl: string,
): string | string[] | null {
  let selected: Cheerio<AnyNode>
  try {
    selected = field.selector === undefined || field.selector === '' ? container : container.find(field.selector)
  } catch {
    throw new PtcWebError('invalid_request', `field ${field.name} has an invalid CSS selector`)
  }
  const nodes = field.multiple === true ? selected.toArray() : selected.slice(0, 1).toArray()
  const values = nodes
    .map((node) => valueOf($(node), field, baseUrl))
    .filter((value): value is string => value !== null)
  return field.multiple === true ? values : (values[0] ?? null)
}

function valueOf(node: Cheerio<AnyNode>, field: FieldSpec, baseUrl: string): string | null {
  const source = field.source ?? 'text'
  if (source === 'attribute') {
    const attribute = field.attribute
    if (attribute === undefined) throw new PtcWebError('invalid_request', `field ${field.name} requires attribute`)
    const value = node.attr(attribute)
    if (value === undefined) return null
    if ((attribute === 'href' || attribute === 'src') && value !== '') {
      try {
        return new URL(value, baseUrl).href
      } catch {
        return value.trim()
      }
    }
    return value.trim()
  }
  if (source === 'html') return node.html()?.trim() ?? null
  return node.text().replace(/\s+/g, ' ').trim()
}

function validateSpec(spec: ExtractionSpec): void {
  if (spec.container.trim() === '') throw new PtcWebError('invalid_request', 'container selector must not be empty')
  if (spec.fields.length === 0) throw new PtcWebError('invalid_request', 'at least one field is required')
  const names = new Set<string>()
  for (const field of spec.fields) {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(field.name))
      throw new PtcWebError('invalid_request', 'field names must be stable identifiers of at most 64 characters')
    if (names.has(field.name)) throw new PtcWebError('invalid_request', `duplicate field name: ${field.name}`)
    names.add(field.name)
    if (field.source === 'attribute' && (field.attribute === undefined || field.attribute === '')) {
      throw new PtcWebError('invalid_request', `field ${field.name} requires attribute`)
    }
    if (field.source !== 'attribute' && field.attribute !== undefined) {
      throw new PtcWebError('invalid_request', `field ${field.name} supplies attribute without attribute source`)
    }
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}
