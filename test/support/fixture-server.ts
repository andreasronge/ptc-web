import { createServer, type Server } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const FIXTURES = join(process.cwd(), 'test', 'fixtures')

export interface FixtureServer {
  origin: string
  server: Server
  close(): Promise<void>
}

export async function startFixtureServer(): Promise<FixtureServer> {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://fixture.invalid')
    if (url.pathname === '/api/items') {
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify([
          { id: 'i1', name: 'Compass' },
          { id: 'i2', name: 'Lantern' },
        ]),
      )
      return
    }
    if (url.pathname === '/oversize') {
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end(`<!doctype html><title>Large</title><main>${'boundary '.repeat(20_000)}</main>`)
      return
    }
    if (url.pathname === '/redirect') {
      response.statusCode = 302
      response.setHeader('location', url.searchParams.get('to') ?? '/article.html')
      response.end()
      return
    }
    if (url.pathname === '/subrequest') {
      const target = url.searchParams.get('target') ?? ''
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end(`<!doctype html><title>Subrequest</title><img src="${escapeHtml(target)}"><p>visible</p>`)
      return
    }
    if (url.pathname === '/slow') return
    const name = url.pathname.slice(1)
    if (!/^(article|listing|discussion|documentation|dynamic)\.html$/.test(name)) {
      response.statusCode = 404
      response.end('not found')
      return
    }
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end(await readFile(join(FIXTURES, name)))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('fixture server did not bind TCP')
  return {
    origin: `http://127.0.0.1:${address.port}`,
    server,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error === undefined ? resolve() : reject(error))),
      ),
  }
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
}
