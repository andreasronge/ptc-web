import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const directory = dirname(fileURLToPath(import.meta.url))
const root = resolve(directory, '../../..')
const project = join(directory, 'ptc-project.json')
const envFile = process.argv[2]
assert.ok(envFile, 'Usage: node examples/ptc/site-learning/run.mjs /absolute/path/to/.env [probe-url] [next-url]')
const probeUrl = process.argv[3] ?? 'https://quotes.toscrape.com/tag/love/'
const nextUrl = process.argv[4] ?? 'https://quotes.toscrape.com/tag/life/'
for (const url of [probeUrl, nextUrl]) assert.ok(['http:', 'https:'].includes(new URL(url).protocol))
assert.equal(new URL(probeUrl).origin, new URL(nextUrl).origin, 'Reuse must stay on the same origin')
assert.notEqual(probeUrl, nextUrl, 'Use a different page to test reuse')
const artifactRoot = join(directory, '.ptc')
const demoRoot = join(directory, '.local')
await mkdir(demoRoot, { recursive: true, mode: 0o700 })
const runDirectory = await mkdtemp(join(demoRoot, 'demo-'))
await mkdir(join(runDirectory, 'analysis'), { mode: 0o700 })
const host = JSON.parse(await readFile(join(directory, 'ptc-host.json'), 'utf8'))
host.install.web.transport.command = process.execPath
host.install.web.transport.cwd = root
const hostPath = join(runDirectory, 'host.json')
await save(hostPath, host)
const baseArgs = ['--host-config', hostPath, '--env-file', resolve(envFile)]

async function ptc(args) {
  try {
    return await execute('ptc', args, { cwd: root, timeout: 210000, maxBuffer: 4 * 1024 * 1024 })
  } catch (error) {
    // PtcRunner diagnostics are bounded; do not dump the child environment or model request.
    throw new Error(`ptc ${args[0]} failed: ${error.stderr ?? error.message}`)
  }
}
async function save(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
}
async function runStage(name, input, override) {
  console.log(`${name}: running PTC workflow`)
  const inputPath = join(runDirectory, `${name}-input.json`)
  const envelopePath = join(runDirectory, `${name}-envelope.json`)
  await save(inputPath, input)
  await ptc([
    'run',
    project,
    ...baseArgs,
    '--input',
    inputPath,
    '--envelope',
    envelopePath,
    ...(override ? ['--component-override-descriptor', override] : []),
  ])
  const envelope = JSON.parse(await readFile(envelopePath, 'utf8'))
  assert.equal(envelope.status, 'ok')
  assert.equal(envelope.execution.outcome, 'ok')
  const value = envelope.result.value
  await save(join(runDirectory, `${name}-result.json`), value)
  return { envelope, value }
}
async function inspect(name, runRef, expectedNames) {
  const { stdout } = await ptc([
    'repl',
    '--profile',
    'private-run-analysis-v2',
    '--run',
    runRef,
    '--resource',
    `traces=${artifactRoot}/traces`,
    '--resource',
    `inspection=${artifactRoot}/inspection`,
    '--session-trace-dir',
    join(runDirectory, 'analysis'),
    '--private-unattended',
    '--format',
    'jsonl',
    '-e',
    `(analysis/read ${JSON.stringify(runRef)} {"collection" "provider_exchanges" "limit" 100})`,
  ])
  const event = stdout
    .trim()
    .split('\n')
    .map(JSON.parse)
    .find((item) => item.type === 'evaluation')
  assert.equal(event.result.status, 'ok')
  const page = event.result.value
  assert.equal(page.next_cursor, null)
  assert.equal(page.truncated, false)
  assert.equal(page.omitted_count, 0)
  await save(join(runDirectory, `${name}-exchanges.json`), page)
  const calls = page.items.filter((item) => item.request?.method === 'tools/call')
  assert.deepEqual(
    calls.map((item) => item.request.params.name),
    expectedNames,
  )
  for (const call of calls) {
    assert.equal(call.run_id, runRef)
    assert.ok(call.response_sequence > call.request_sequence)
    assert.equal(call['response_available?'], true)
    assert.equal(call.request.params._meta['io.modelcontextprotocol/protocolVersion'], '2026-07-28')
    assert.equal(call.response.id, call.request.id)
    assert.equal(call.response.error, undefined)
    assert.notEqual(call.response.result.isError, true)
    assert.equal(call.response.result.resultType, 'complete')
    assert.ok(call.response.result.structuredContent)
  }
  console.log(`${name}: inspected ${calls.length} MCP exchanges using ptc repl`)
  return calls.map((item) => ({ tool: item.request.params.name, arguments: item.request.params.arguments }))
}
function checkExtraction(value) {
  assert.equal(value.closed, true)
  const extraction = value.extraction
  assert.ok(extraction.records.length > 0, 'Learned recipe returned no records')
  assert.equal(extraction.omitted_records, 0)
  assert.equal(extraction.result_truncated, false)
  assert.equal(extraction.next_cursor, null, 'This bounded demo requires a single result page')
  for (const record of extraction.records) {
    for (const value of Object.values(record)) assert.ok(typeof value === 'string' && value.trim().length > 0)
  }
}

console.log(`Artifacts: ${runDirectory}`)
await ptc(['version', '--envelope', join(runDirectory, 'version.json')])
await ptc(['validate', project, '--host-config', hostPath])
const probe = await runStage('probe', { phase: 'probe', url: probeUrl })
assert.equal(probe.value.closed, true)
assert.equal(new URL(probe.value.url).origin, new URL(probeUrl).origin)
assert.equal(probe.value.markdown.next_cursor, null, 'Probe Markdown exceeded the demo evidence budget')
const calls = await inspect('probe', probe.envelope.run_ref, [
  'page_open',
  'page_capture',
  'page_read',
  'page_extract',
  'page_close',
])
if (/unusual traffic|captcha|verify you are human/i.test(probe.value.markdown.content)) {
  throw new Error(
    'The site returned a challenge page; inspect probe-exchanges.json. No recipe will be learned from it.',
  )
}
const learned = await runStage('learn', {
  phase: 'learn',
  question: 'Which quotations appear on this page, and who is each quotation attributed to?',
  evidence: probe.value,
  inspected_calls: calls,
})
assert.ok(learned.value.component_source.length < 8000)
const candidateDirectory = join(runDirectory, 'candidate')
await ptc([
  'materialize',
  project,
  '--target-mission',
  'browser',
  '--component',
  'site.recipe',
  '--from-result',
  join(runDirectory, 'learn-result.json'),
  '--result-pointer',
  '/component_source',
  '--out',
  candidateDirectory,
])
const descriptor = join(candidateDirectory, 'descriptor.json')
await ptc(['validate', project, '--host-config', hostPath, '--component-override-descriptor', descriptor])
const checked = await runStage('check', { phase: 'query', url: probeUrl }, descriptor)
checkExtraction(checked.value)
await inspect('check', checked.envelope.run_ref, ['page_open', 'page_capture', 'page_extract', 'page_close'])
const reused = await runStage('reuse', { phase: 'query', url: nextUrl }, descriptor)
checkExtraction(reused.value)
assert.deepEqual(reused.envelope.execution.usage.llm_usage, [], 'Reuse must not call a model')
assert.equal(new URL(reused.value.url).origin, new URL(probeUrl).origin)
await inspect('reuse', reused.envelope.run_ref, ['page_open', 'page_capture', 'page_extract', 'page_close'])
const report = {
  ptc: JSON.parse(await readFile(join(runDirectory, 'version.json'), 'utf8')).result,
  probe_url: probeUrl,
  next_url: nextUrl,
  recipe: learned.value.recipe,
  probe_records: checked.value.extraction.records.length,
  next_records: reused.value.extraction.records,
  question: 'Which quotations appear on the next page, and who is each quotation attributed to?',
  scope: 'First captured page, at most ten records; site pagination is not followed.',
  llm_usage: learned.envelope.execution.usage.llm_usage,
  run_refs: [probe, learned, checked, reused].map((stage) => stage.envelope.run_ref),
  descriptor,
}
await save(join(runDirectory, 'report.json'), report)
console.log(JSON.stringify(report, null, 2))
