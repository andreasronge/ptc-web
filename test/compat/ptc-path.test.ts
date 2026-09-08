import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { startFixtureServer } from '../support/fixture-server.js'

const execute = promisify(execFile)
const enabled = process.env.PTC_WEB_TEST_PATH_PTC === '1'

test(
  'the ptc on PATH initializes, validates, diagnoses, and runs a ptc-web project',
  {
    skip: enabled ? false : 'set PTC_WEB_TEST_PATH_PTC=1 or run pnpm run test:ptc:path',
    timeout: 180_000,
  },
  async (t) => {
    const fixture = await startFixtureServer()
    const parent = await mkdtemp(join(tmpdir(), 'ptc-web-path-'))
    const projectDirectory = join(parent, 'project')
    const environment = { ...process.env, PTC_WEB_ALLOW_LOCAL_ORIGINS: fixture.origin }
    t.after(async () => {
      await fixture.close()
      await rm(parent, { recursive: true, force: true })
    })

    const versionEnvelopePath = join(parent, 'version-envelope.json')
    await execute('ptc', ['version', '--envelope', versionEnvelopePath], { env: environment })
    const versionEnvelope = await readJson(versionEnvelopePath)
    assert.equal(versionEnvelope.status, 'ok')
    const version = objectAt(versionEnvelope, 'result')
    assert.equal(typeof version.version, 'string')
    assert.match(String(version.source_revision), /^[0-9a-f]{40}$/)
    t.diagnostic(`PATH ptc ${String(version.version)} (${String(version.source_revision)})`)

    const initEnvelopePath = join(parent, 'init-envelope.json')
    await execute('ptc', ['init', projectDirectory, '--envelope', initEnvelopePath], { env: environment })
    assert.equal((await readJson(initEnvelopePath)).status, 'ok')
    await Promise.all(
      ['AGENTS.md', 'main.clj', 'ptc.json', 'ptc-project.json'].map(async (name) => {
        assert.ok((await readFile(join(projectDirectory, name), 'utf8')).length > 0, `${name} was not initialized`)
      }),
    )

    const program = `(let [opened-call (tool/web.open {"url" "${fixture.origin}/listing.html"}) opened (get opened-call :value) captured-call (tool/web.capture {"handle_id" (get opened "handle_id")}) captured (get captured-call :value) extracted-call (tool/web.extract {"snapshot_id" (get captured "snapshot_id") "container" ".story" "fields" [{"name" "title" "selector" ".title" "required" true}] "limit" 10}) extracted (get extracted-call :value) find-call (tool/web.find {"snapshot_id" (get captured "snapshot_id") "query" "launch"}) found (get find-call :value) closed-call (tool/web.close {"handle_id" (get opened "handle_id")}) closed (get closed-call :value) read-call (tool/web.read {"snapshot_id" (get captured "snapshot_id") "format" "markdown" "extraction" "document"}) read (get read-call :value)] (return {"title" (get captured "title") "records" (get extracted "records") "matches" (get found "matches") "closed" (get closed "closed") "content_after_close" (get read "content")}))`
    await Promise.all([
      writeFile(
        join(projectDirectory, 'main.clj'),
        '(ns path.web)\n(defn run [input] (return (tool/kernel-eval {"mission" "default" "kind" :source "source" (get input "program")})))\n',
      ),
      writeJson(join(projectDirectory, 'ptc.json'), {
        version: 1,
        workflow: { components: [{ id: 'path.web', path: 'main.clj' }], entry: 'path.web/run' },
        missions: { default: { components: [], data: {}, providers: ['web'] } },
        input: { value: { program } },
        providers: { mission: [{ name: 'web' }] },
        limits: { evaluation_timeout_ms: 30_000, run_duration_ms: 90_000 },
      }),
      writeJson(join(projectDirectory, 'ptc-host.json'), hostConfiguration()),
      updateInitializedProject(join(projectDirectory, 'ptc-project.json')),
    ])

    const projectPath = join(projectDirectory, 'ptc-project.json')
    const validateEnvelope = await ptcEnvelope(parent, environment, 'validate', [projectPath])
    assert.equal(validateEnvelope.status, 'ok')

    const passiveDoctor = await ptcEnvelope(parent, environment, 'doctor-passive', ['doctor', projectPath])
    assert.equal(passiveDoctor.status, 'ok')
    assert.match(JSON.stringify(passiveDoctor), /provider\/web/)

    const activeDoctor = await ptcEnvelope(parent, environment, 'doctor-connect', [
      'doctor',
      projectPath,
      '--connect',
    ])
    assert.equal(activeDoctor.status, 'ok')
    assert.match(JSON.stringify(activeDoctor), /available/)

    const runEnvelope = await ptcEnvelope(parent, environment, 'run', ['run', projectPath])
    assert.equal(runEnvelope.status, 'ok')
    const evaluation = objectAt(objectAt(objectAt(runEnvelope, 'result'), 'value'), 'value')
    assert.equal(evaluation.outcome, 'returned')
    const result = objectAt(evaluation, 'value')
    assert.equal(result.title, 'Launch board')
    assert.deepEqual(result.records, [{ title: 'Alpha launch' }, { title: 'Beta ships' }, { title: 'Gamma notes' }])
    assert.equal(result.closed, true)
    assert.ok(Array.isArray(result.matches) && result.matches.length > 0)
    assert.match(String(result.content_after_close), /Alpha launch/)
    const analysisDirectory = join(parent, 'analysis')
    await mkdir(analysisDirectory)
    const inspected = await execute(
      'ptc',
      [
        'repl',
        '--profile',
        'private-run-analysis-v2',
        '--session-trace-dir',
        analysisDirectory,
        '--run',
        String(runEnvelope.run_ref),
        '--resource',
        `traces=${projectDirectory}/.ptc/traces`,
        '--resource',
        `inspection=${projectDirectory}/.ptc/inspection`,
        '--private-unattended',
        '--format',
        'jsonl',
        '-e',
        `(analysis/read "${String(runEnvelope.run_ref)}" {"collection" "provider_exchanges" "limit" 100})`,
      ],
      { env: environment, maxBuffer: 2 * 1024 * 1024 },
    )
    const events = inspected.stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    const inspectedEvaluation = events.find((event) => event.type === 'evaluation').result
    assert.equal(inspectedEvaluation.status, 'ok')
    const page = inspectedEvaluation.value
    assert.equal(page.next_cursor, null)
    assert.equal(page.truncated, false)
    assert.equal(page.omitted_count, 0)
    const exchanges = page.items
    assert.deepEqual(
      exchanges.map((exchange: any) => exchange.request.params.name),
      ['page_open', 'page_capture', 'page_extract', 'page_find', 'page_close', 'page_read'],
    )
    const requestIds = new Set()
    for (const exchange of exchanges) {
      assert.equal(exchange.run_id, runEnvelope.run_ref)
      assert.equal(exchange.request.method, 'tools/call')
      assert.equal(exchange.request.params._meta['io.modelcontextprotocol/protocolVersion'], '2026-07-28')
      assert.equal(exchange.capture_mode, 'digest_results')
      assert.equal(exchange['response_available?'], false)
      assert.ok(exchange.response_sequence > exchange.request_sequence)
      assert.match(exchange.response_identity.sha256, /^sha256:[0-9a-f]{64}$/)
      assert.ok(exchange.response_identity.encoded_bytes > 0)
      requestIds.add(exchange.request_id)
    }
    assert.equal(requestIds.size, 6)
    const args = exchanges.map((exchange: any) => exchange.request.params.arguments)
    assert.equal(args[0].url, `${fixture.origin}/listing.html`)
    assert.equal(args[1].handle_id, args[4].handle_id)
    assert.equal(args[2].snapshot_id, args[3].snapshot_id)
    assert.equal(args[2].snapshot_id, args[5].snapshot_id)
    t.diagnostic('Private inspection verified six ordered MCP tool exchanges and response identities.')
  },
)

function hostConfiguration(): unknown {
  return {
    credentials: { fixture_origin: { env: 'PTC_WEB_ALLOW_LOCAL_ORIGINS' } },
    install: {
      web: {
        source: 'mcp',
        installation_revision: 'ptc-web-path-compat-v1',
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
            {
              as: `web.${name.replace('page_', '')}`,
              effect: 'read',
              error_feedback: 'bounded',
              inspection_capture: 'digest_results',
            },
          ]),
        ),
        ceilings: { timeout_ms: 30_000, max_catalog_tools: 8, max_result_bytes: 262_144 },
      },
    },
  }
}

async function updateInitializedProject(path: string): Promise<void> {
  const project = await readJson(path)
  project.host = { path: 'ptc-host.json' }
  project.artifacts = { root: '.ptc', trace: true, inspection: true, result: false, envelope: true }
  await writeJson(path, project)
}

async function ptcEnvelope(
  parent: string,
  environment: NodeJS.ProcessEnv,
  name: string,
  args: string[],
): Promise<Record<string, unknown>> {
  const envelopePath = join(parent, `${name}-envelope.json`)
  const command = args[0] === 'doctor' || args[0] === 'run' ? args : ['validate', ...args]
  await execute('ptc', [...command, '--envelope', envelopePath], {
    env: environment,
    timeout: 150_000,
    maxBuffer: 2 * 1024 * 1024,
  })
  return readJson(envelopePath)
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  const value: unknown = JSON.parse(await readFile(path, 'utf8'))
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value))
  return value as Record<string, unknown>
}

function objectAt(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const child = value[key]
  assert.ok(child !== null && typeof child === 'object' && !Array.isArray(child))
  return child as Record<string, unknown>
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}
