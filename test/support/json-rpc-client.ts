import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'

const META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'ptc-web-test', version: '0.1.0' },
  'io.modelcontextprotocol/clientCapabilities': {},
}

export class JsonRpcClient {
  private readonly child: ChildProcessWithoutNullStreams
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>()
  private nextId = 1
  private stderr = ''

  constructor(environment: NodeJS.ProcessEnv) {
    this.child = spawn(process.execPath, ['dist/src/cli.js'], {
      cwd: process.cwd(),
      env: environment,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    createInterface({ input: this.child.stdout }).on('line', (line) => this.receive(line))
    this.child.stderr.setEncoding('utf8')
    this.child.stderr.on('data', (chunk: string) => {
      this.stderr += chunk
    })
    this.child.once('exit', (code) => {
      for (const pending of this.pending.values())
        pending.reject(new Error(`MCP server exited with ${String(code)}: ${this.stderr}`))
      this.pending.clear()
    })
  }

  request(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = this.nextId++
    const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as Record<string, unknown>), reject })
    })
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params: { ...params, _meta: META } })}\n`)
    return promise
  }

  async tool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await this.request('tools/call', { name, arguments: args })
    const result = response.result as Record<string, unknown>
    if (result.isError === true) throw new Error(JSON.stringify(result.structuredContent ?? result.content))
    return result.structuredContent as Record<string, unknown>
  }

  async close(): Promise<void> {
    if (this.child.exitCode !== null) return
    this.child.kill('SIGTERM')
    await new Promise<void>((resolve) => this.child.once('exit', () => resolve()))
  }

  private receive(line: string): void {
    let message: Record<string, unknown>
    try {
      message = JSON.parse(line) as Record<string, unknown>
    } catch {
      for (const pending of this.pending.values()) pending.reject(new Error(`invalid JSON-RPC response: ${line}`))
      this.pending.clear()
      return
    }
    const id = message.id
    if (typeof id !== 'number') return
    const pending = this.pending.get(id)
    if (pending === undefined) return
    this.pending.delete(id)
    if (message.error !== undefined) pending.reject(new Error(JSON.stringify(message.error)))
    else pending.resolve(message)
  }
}
