import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { startFixtureServer } from '../support/fixture-server.js'

const execute = promisify(execFile)
const PTC_RUNNER = resolve(process.env.PTC_RUNNER_CHECKOUT ?? '../ptc_runner')
const PTC_RUNNER_COMMIT = 'f53170ebf304ef0caf3a8aca44233f3f255e2c5f'
const hasPtcRunnerCheckout = existsSync(join(PTC_RUNNER, 'mix.exs'))

test(
  'PtcRunner acquires and calls ptc-web over a real MCP stdio boundary',
  {
    timeout: 120_000,
    skip: hasPtcRunnerCheckout ? false : 'set PTC_RUNNER_CHECKOUT to a compatible PtcRunner source checkout',
  },
  async (t) => {
    const actualCommit = (await execute('git', ['rev-parse', 'HEAD'], { cwd: PTC_RUNNER })).stdout.trim()
    assert.equal(
      actualCommit,
      PTC_RUNNER_COMMIT,
      'update the recorded compatibility commit after intentionally validating a new PtcRunner revision',
    )
    const fixture = await startFixtureServer()
    const directory = await mkdtemp(join(tmpdir(), 'ptc-web-compat-'))
    t.after(async () => {
      await fixture.close()
      await rm(directory, { recursive: true, force: true })
    })

    const program = `(let [opened-call (tool/web.open {"url" "${fixture.origin}/listing.html"}) opened (get opened-call :value) captured-call (tool/web.capture {"handle_id" (get opened "handle_id")}) captured (get captured-call :value) extracted-call (tool/web.extract {"snapshot_id" (get captured "snapshot_id") "container" ".story" "fields" [{"name" "title" "selector" ".title" "required" true}] "limit" 10}) extracted (get extracted-call :value) closed-call (tool/web.close {"handle_id" (get opened "handle_id")}) closed (get closed-call :value)] (return {"title" (get captured "title") "records" (get extracted "records") "closed" (get closed "closed")}))`
    await Promise.all([
      writeFile(
        join(directory, 'workflow.clj'),
        '(ns compat.web)\n(defn run [input] (return (tool/kernel-eval {"mission" "default" "kind" :source "source" (get input "program")})))\n',
      ),
      writeJson(join(directory, 'ptc.json'), {
        version: 1,
        workflow: { components: [{ id: 'compat.web', path: 'workflow.clj' }], entry: 'compat.web/run' },
        missions: { default: { components: [], data: {}, providers: ['web'] } },
        input: { value: { program } },
        providers: { mission: [{ name: 'web' }] },
        limits: { evaluation_timeout_ms: 20_000, run_duration_ms: 60_000 },
      }),
      writeJson(join(directory, 'ptc-host.json'), {
        credentials: { fixture_origin: { env: 'PTC_WEB_ALLOW_LOCAL_ORIGINS' } },
        install: {
          web: {
            source: 'mcp',
            installation_revision: `ptc-web-0.1.0-ptc-${PTC_RUNNER_COMMIT.slice(0, 12)}`,
            transport: {
              type: 'stdio',
              command: process.execPath,
              cwd: process.cwd(),
              args: ['dist/src/cli.js'],
              inherit_environment: true,
              env: { PTC_WEB_ALLOW_LOCAL_ORIGINS: { binding: 'fixture_origin' } },
              start_timeout_ms: 20_000,
            },
            tools: Object.fromEntries(
              ['page_open', 'page_capture', 'page_read', 'page_extract', 'page_find', 'page_close'].map((name) => [
                name,
                { as: `web.${name.replace('page_', '')}`, effect: 'read', error_feedback: 'bounded' },
              ]),
            ),
            ceilings: { timeout_ms: 20_000, max_catalog_tools: 8, max_result_bytes: 262_144 },
          },
        },
      }),
      writeJson(join(directory, 'ptc-project.json'), {
        kind: 'ptc-project',
        version: 1,
        application: { path: 'ptc.json' },
        host: { path: 'ptc-host.json' },
        artifacts: { root: '.ptc', trace: false, inspection: false, result: false, envelope: false },
      }),
    ])

    const result = await execute('mix', ['ptc', 'run', join(directory, 'ptc-project.json')], {
      cwd: PTC_RUNNER,
      env: { ...process.env, PTC_WEB_ALLOW_LOCAL_ORIGINS: fixture.origin },
      timeout: 100_000,
      maxBuffer: 2 * 1024 * 1024,
    })
    assert.match(result.stdout, /Launch board/)
    assert.match(result.stdout, /Alpha launch/)
    assert.match(result.stdout, /"closed":true/)
  },
)

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}
