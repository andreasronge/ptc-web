import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { startChangingFixture, expected } from '../repair-loop/fixtures.mjs'

const execute = promisify(execFile)
const directory = dirname(fileURLToPath(import.meta.url))
const root = resolve(directory, '../../..')
const fsCli = resolve(process.argv[2] ?? process.env.PTC_FS_MCP_CLI ?? '../ptc-fs-mcp/dist/cli.js')
await access(fsCli)
await mkdir(join(directory, '.local'), { recursive: true, mode: 0o700 })
const output = await mkdtemp(join(directory, '.local/run-'))
const projectDir = join(output, 'project')
const storage = join(output, 'saved')
for (const path of [projectDir, storage, join(output, 'analysis')]) await mkdir(path, { mode: 0o700 })
const project = join(projectDir, 'ptc-project.json')
const fixture = await startChangingFixture()
fixture.change(2)
const oldSource = await readFile(join(directory, 'parser-v1.clj'), 'utf8')
const newSource = await readFile(join(directory, 'parser-v2.clj'), 'utf8')
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const input = {
  mode: 'replace',
  url: `${fixture.origin}/quotes`,
  held_url: `${fixture.origin}/held-out`,
  old_source: oldSource,
  new_source: newSource,
  expected: expected['/quotes'],
  held_expected: expected['/held-out'],
}
async function save(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
}
async function ptc(args) {
  return execute('ptc', args, {
    cwd: root,
    timeout: 120000,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, PTC_DYNAMIC_FIXTURE_ORIGIN: fixture.origin },
  })
}
async function run(name, value, shouldFail = false) {
  await save(join(output, `${name}-input.json`), value)
  let error
  try {
    await ptc([
      'run',
      project,
      '--input',
      join(output, `${name}-input.json`),
      '--envelope',
      join(output, `${name}-envelope.json`),
    ])
  } catch (caught) {
    error = caught
  }
  const envelope = JSON.parse(await readFile(join(output, `${name}-envelope.json`), 'utf8'))
  if (shouldFail) {
    assert.equal(envelope.status, 'error')
    assert.match(JSON.stringify(envelope), /explicit_failure/)
  } else {
    if (error) throw new Error(error.stderr || error.message)
    assert.equal(envelope.status, 'ok')
  }
  assert.deepEqual(envelope.execution.usage.llm_usage, [])
  return envelope
}
async function inspect(name, runRef) {
  const { stdout } = await ptc([
    'repl',
    '--profile',
    'private-run-analysis-v2',
    '--run',
    runRef,
    '--resource',
    `traces=${projectDir}/.ptc/traces`,
    '--resource',
    `inspection=${projectDir}/.ptc/inspection`,
    '--session-trace-dir',
    join(output, 'analysis'),
    '--private-unattended',
    '--format',
    'jsonl',
    '-e',
    `(analysis/read "${runRef}" {"collection" "provider_exchanges" "limit" 100})`,
  ])
  const event = stdout
    .trim()
    .split('\n')
    .map(JSON.parse)
    .find((row) => row.type === 'evaluation')
  assert.equal(event.result.status, 'ok')
  const page = event.result.value
  assert.equal(page.next_cursor, null)
  assert.equal(page.truncated, false)
  assert.equal(page.omitted_count, 0)
  for (const exchange of page.items) {
    assert.equal(exchange.run_id, runRef)
    assert.equal(exchange.response.id, exchange.request.id)
    assert.equal(exchange.response.error, undefined)
    assert.notEqual(exchange.response.result.isError, true)
  }
  await save(join(output, `${name}-exchanges.json`), page)
  return page.items
}

console.log(`Artifacts: ${output}`)
try {
  await writeFile(join(projectDir, 'workflow.clj'), await readFile(join(directory, 'workflow.clj')), { mode: 0o600 })
  await save(join(projectDir, 'ptc.json'), {
    version: 1,
    workflow: {
      components: [{ id: 'dynamic.workflow', path: 'workflow.clj', dependencies: ['kernel'] }, { library: 'kernel' }],
      entry: 'dynamic.workflow/run',
    },
    missions: Object.fromEntries(
      [
        ['browser', 'web'],
        ['reader', 'fs_reader'],
        ['writer', 'fs_writer'],
      ].map(([name, provider]) => [name, { components: [], data: {}, providers: [provider] }]),
    ),
    providers: {
      mission: [{ name: 'web' }, { name: 'fs_reader' }, { name: 'fs_writer', config: { allow: ['fs.write'] } }],
    },
    input: { value: input },
    limits: { run_duration_ms: 90000, evaluation_timeout_ms: 15000, subordinate_evaluations: 16 },
  })
  const web = JSON.parse(await readFile(join(directory, '../site-learning/ptc-host.json'), 'utf8')).install.web
  web.transport.command = process.execPath
  web.transport.cwd = root
  web.transport.env = { PTC_WEB_ALLOW_LOCAL_ORIGINS: { binding: 'fixture_origin' } }
  const fsDigest = sha256(await readFile(fsCli))
  function fsProvider(tool, alias, effect) {
    return {
      source: 'mcp',
      installation_revision: `dynamic-parser-fs-${fsDigest.slice(0, 12)}`,
      transport: {
        type: 'stdio',
        command: process.execPath,
        cwd: root,
        args: [fsCli, '--root', storage, '--include', '*.clj'],
        inherit_environment: false,
        env: {},
        start_timeout_ms: 15000,
      },
      tools: { [tool]: { as: alias, effect } },
      ceilings: { timeout_ms: 15000, max_catalog_tools: 8, max_result_bytes: 262144 },
    }
  }
  await save(join(projectDir, 'host.json'), {
    credentials: { fixture_origin: { env: 'PTC_DYNAMIC_FIXTURE_ORIGIN' } },
    install: {
      web,
      fs_reader: fsProvider('read_text_file', 'fs.read', 'read'),
      fs_writer: fsProvider('write_text_file', 'fs.write', 'write'),
    },
  })
  await save(project, {
    kind: 'ptc-project',
    version: 1,
    application: { path: 'ptc.json' },
    host: { path: 'host.json' },
    artifacts: { root: '.ptc', trace: true, inspection: true, result: true, envelope: true },
  })
  await ptc(['version', '--envelope', join(output, 'version.json')])
  await ptc(['validate', project])

  console.log('Rejecting a parser that passes the first page but misses a held-out record…')
  const rejected = await run('rejected', { ...input, new_source: newSource.replace('"limit" 10', '"limit" 3') }, true)
  await assert.rejects(access(join(storage, 'parser-v2.clj')))
  const rejectedCalls = await inspect('rejected', rejected.run_ref)
  assert.ok(!rejectedCalls.some((call) => call.request.params.name === 'write_text_file'))
  const rejectedExtractions = rejectedCalls
    .filter((call) => call.request.params.name === 'page_extract')
    .map((call) => call.response.result.structuredContent)
  assert.equal(rejectedExtractions.length, 3)
  assert.deepEqual(rejectedExtractions[1].records, expected['/quotes'])
  assert.equal(rejectedExtractions[2].records.length, 3)
  assert.ok(rejectedExtractions[2].next_cursor)

  console.log('Replacing, testing, saving and reusing a parser inside one PTC run…')
  const replaced = await run('replace', input)
  const value = replaced.result.value
  assert.deepEqual(value.old.records, [])
  for (const key of ['repaired', 'reused_from_disk']) assert.deepEqual(value[key].records, expected['/quotes'])
  assert.deepEqual(value.held_out.records, expected['/held-out'])
  assert.equal(value.loaded_source, newSource)
  assert.equal(value.closed.closed, true)
  assert.equal(value.held_closed.closed, true)
  assert.equal(value.write_denied.outcome, 'invalid')
  assert.equal(value.write_denied.diagnostic.kind, 'unknown_tool')
  assert.equal(await readFile(join(storage, 'parser-v2.clj'), 'utf8'), newSource)
  const exchanges = await inspect('replace', replaced.run_ref)
  const names = exchanges.map((call) => call.request.params.name)
  assert.deepEqual(names, [
    'page_open',
    'page_capture',
    'page_extract',
    'page_extract',
    'page_open',
    'page_capture',
    'page_extract',
    'write_text_file',
    'read_text_file',
    'page_extract',
    'page_close',
    'page_close',
  ])
  const extracts = exchanges.filter((call) => call.request.params.name === 'page_extract')
  assert.equal(extracts[0].request.params.arguments.snapshot_id, extracts[1].request.params.arguments.snapshot_id)
  assert.equal(extracts[0].request.params.arguments.snapshot_id, extracts[3].request.params.arguments.snapshot_id)

  console.log('Starting a later run with only the saved file—no parser source in its input…')
  const reloaded = await run('reload', { mode: 'reload', url: input.url })
  assert.deepEqual(reloaded.result.value.result.records, expected['/quotes'])
  assert.equal(reloaded.result.value.loaded_source, newSource)
  assert.equal(reloaded.result.value.closed.closed, true)
  const reloadCalls = await inspect('reload', reloaded.run_ref)
  assert.deepEqual(
    reloadCalls.map((call) => call.request.params.name),
    ['page_open', 'page_capture', 'read_text_file', 'page_extract', 'page_close'],
  )
  const report = {
    status: 'passed',
    ptc: JSON.parse(await readFile(join(output, 'version.json'), 'utf8')).result,
    fs_cli: fsCli,
    fs_cli_sha256: sha256(await readFile(fsCli)),
    saved_source_sha256: sha256(newSource),
    replacement_run: replaced.run_ref,
    reload_run: reloaded.run_ref,
    rejected_run: rejected.run_ref,
    same_snapshot_reused: true,
    held_out_passed: true,
    browser_write_denied: true,
    failed_candidate_not_saved: true,
    model_calls: 0,
    replacement_mission_evaluations: replaced.execution.usage.evaluations_by_mission,
    replacement_mcp_calls: names,
    saved_file: join(storage, 'parser-v2.clj'),
  }
  await save(join(output, 'report.json'), report)
  console.log(JSON.stringify(report, null, 2))
} finally {
  await fixture.close()
}
