export interface FindMatch {
  offset: number
  passage: string
}

export function findPassages(
  content: string,
  query: string,
  maximum: number,
  contextCharacters = 160,
): { matches: FindMatch[]; truncated: boolean } {
  const foldedContent = content.toLocaleLowerCase()
  const foldedQuery = query.toLocaleLowerCase()
  const matches: FindMatch[] = []
  let position = 0
  let hasMore = false
  while (position <= foldedContent.length - foldedQuery.length) {
    const offset = foldedContent.indexOf(foldedQuery, position)
    if (offset === -1) break
    if (matches.length >= maximum) {
      hasMore = true
      break
    }
    const start = Math.max(0, offset - contextCharacters)
    const end = Math.min(content.length, offset + query.length + contextCharacters)
    matches.push({
      offset,
      passage: `${start > 0 ? '…' : ''}${content.slice(start, end).replace(/\s+/g, ' ').trim()}${end < content.length ? '…' : ''}`,
    })
    position = offset + Math.max(query.length, 1)
  }
  return { matches, truncated: hasMore }
}
