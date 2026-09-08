#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { configFromEnvironment } from './config.js'
import { createServer, IDENTITY, PtcWebRuntime } from './server.js'

const HELP = `ptc-web ${IDENTITY.version} -- bounded browser-content MCP server

Usage:
  ptc-web

Configuration is supplied through PTC_WEB_* environment variables. See README.md.
Protocol messages go to stdout; diagnostics go to stderr.`

async function main(): Promise<void> {
  if (process.argv.includes('--help')) {
    process.stdout.write(`${HELP}\n`)
    return
  }
  if (process.argv.includes('--version')) {
    process.stdout.write(`${IDENTITY.version}\n`)
    return
  }

  const runtime = new PtcWebRuntime(configFromEnvironment())
  const transport = serveStdio(() => createServer(runtime), {
    legacy: 'reject',
    onerror: () => process.stderr.write('ptc-web transport error\n'),
  })
  let closing = false
  const shutdown = (): void => {
    if (closing) return
    closing = true
    void Promise.allSettled([transport.close(), runtime.close()]).finally(() => process.exit(0))
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  process.once('SIGHUP', shutdown)
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'startup failed'}\n`)
  process.exitCode = 64
})
