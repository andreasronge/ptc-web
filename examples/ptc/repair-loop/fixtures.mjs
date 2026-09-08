import { createServer } from 'node:http'

export const expected = {
  '/quotes': [
    { text: 'Measure the change before changing the measure.', author: 'Ada North' },
    { text: 'A useful question leaves room for evidence.', author: 'Ben West' },
    { text: 'Small checks make large journeys possible.', author: 'Cleo East' },
  ],
  '/held-out': [
    { text: 'A different page deserves the same care.', author: 'Dara South' },
    { text: 'Keep the observation separate from the guess.', author: 'Eli River' },
    { text: 'An empty answer can still look successful.', author: 'Faye Hill' },
    { text: 'A repair earns trust through another test.', author: 'Gus Lake' },
  ],
}

export function render(revision, path) {
  const held = path === '/held-out'
  const rows = expected[path]
  if (!rows) return null
  const cards = rows
    .map(({ text, author }) => {
      if (revision === 1)
        return `<div class="quote"><span class="text">${text}</span><small class="author">${author}</small></div>`
      const attribution =
        revision === 2
          ? `<span class="speaker">${author}</span>`
          : `<footer><cite class="byline">${author}</cite></footer>`
      return held
        ? `<article class="entry"><header>${attribution}</header><section><p class="words">${text}</p></section></article>`
        : `<article class="entry"><p class="words">${text}</p>${attribution}</article>`
    })
    .join('\n')
  return `<!doctype html><html><head><title>Changing quotation board</title></head><body>
    <nav><span class="speaker">Navigation editor</span><cite class="byline">Site editor</cite></nav>
    <main><h1>Quotations</h1>${held ? `<section class="collection">${cards}</section>` : cards}</main>
    <aside><p>Subscribe for updates.</p></aside></body></html>`
}

export async function startChangingFixture() {
  let revision = 1
  const requests = []
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://fixture.invalid').pathname
    requests.push({ revision, path })
    const html = render(revision, path)
    response.writeHead(html ? 200 : 404, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end(html ?? 'Not found')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    requests,
    change(next) {
      if (![1, 2, 3].includes(next)) throw new Error('Unknown fixture revision')
      revision = next
    },
    close: () =>
      new Promise((resolve, reject) => {
        server.closeAllConnections()
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}
