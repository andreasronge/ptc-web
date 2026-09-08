import { Readability } from '@mozilla/readability'
import { JSDOM } from 'jsdom'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import type { Snapshot } from './snapshots.js'
import { PtcWebError } from './errors.js'

export type ContentFormat = 'markdown' | 'text'
export type ExtractionMode = 'article' | 'document'

export interface Representation {
  content: string
  title: string
  byline: string | null
  excerpt: string | null
}

export function representation(
  snapshot: Snapshot,
  format: ContentFormat,
  extraction: ExtractionMode,
): Representation {
  const key = `${format}:${extraction}`
  const cached = snapshot.representations.get(key)
  if (cached !== undefined) return cached

  const dom = new JSDOM(snapshot.html, { url: snapshot.url })
  absolutizeLinks(dom.window.document, snapshot.url)
  let title = snapshot.title
  let byline: string | null = null
  let excerpt: string | null = null
  let root: Element
  if (extraction === 'article') {
    const article = new Readability(dom.window.document.cloneNode(true) as Document).parse()
    if (article === null) throw new PtcWebError('blocked', 'article content could not be identified in this snapshot')
    const articleDom = new JSDOM(article.content ?? '', { url: snapshot.url })
    root = articleDom.window.document.body
    title = article.title || title
    byline = article.byline ?? null
    excerpt = article.excerpt ?? null
  } else {
    root = dom.window.document.body ?? dom.window.document.documentElement
  }

  const body = format === 'text' ? normalizeText(root.textContent ?? '') : toMarkdown(root.innerHTML)
  const content =
    extraction === 'article' && title !== ''
      ? format === 'markdown'
        ? `# ${title.replace(/\n/g, ' ').trim()}\n\n${body}`
        : `${title}\n\n${body}`
      : body
  const result = { content, title, byline, excerpt }
  snapshot.representations.set(key, result)
  return result
}

function toMarkdown(html: string): string {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
  })
  turndown.use(gfm)
  turndown.remove(['script', 'style', 'noscript', 'template'])
  return turndown.turndown(html).trim()
}

function normalizeText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function absolutizeLinks(document: Document, base: string): void {
  for (const element of document.querySelectorAll<HTMLElement>('[href], [src]')) {
    for (const attribute of ['href', 'src']) {
      const raw = element.getAttribute(attribute)
      if (raw === null || raw === '' || raw.startsWith('#') || raw.startsWith('data:')) continue
      try {
        element.setAttribute(attribute, new URL(raw, base).href)
      } catch {
        element.removeAttribute(attribute)
      }
    }
  }
}
