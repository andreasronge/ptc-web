import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { performance } from 'node:perf_hooks'
import { startChangingFixture, expected } from './fixtures.mjs'
import { accuracy, extractionErrors, queryWithRepair } from './policy.mjs'
import { auditDebugReads } from './audit.mjs'

const execute = promisify(execFile)
const directory = dirname(fileURLToPath(import.meta.url))
const root = resolve(directory, '../../..')
const learning = join(directory, '../site-learning')
const envFile = process.argv[2]
const primaryModel = process.env.PTC_REPAIR_MODEL ?? 'openrouter:deepseek/deepseek-v4-flash'
assert.ok(envFile, 'Usage: node examples/ptc/repair-loop/run.mjs /absolute/path/to/.env')
const controller = new AbortController()
const abort = () => controller.abort()
process.once('SIGINT', abort)
process.once('SIGTERM', abort)
const deadline = setTimeout(abort, 10 * 60 * 1000)
deadline.unref()
await mkdir(join(directory, '.local'), { recursive: true, mode: 0o700 })
const output = await mkdtemp(join(directory, '.local/run-'))
const projectDirectory = join(output, 'project')
await mkdir(projectDirectory, { mode: 0o700 })
await mkdir(join(output, 'analysis'), { mode: 0o700 })
const project = join(projectDirectory, 'ptc-project.json')
const fixture = await startChangingFixture()
const started = performance.now()
const stages = []
const queries = []
let sequence = 0
let modelAttempts = 0
let active = null
let failure
let version
let evidence
let repairHost
let repairHostConfiguration
console.log(`Repair-loop artifacts: ${output}`)

async function save(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
}
async function ptc(args) {
  try {
    return await execute('ptc', args, {
      cwd: root,
      timeout: 210000,
      signal: controller.signal,
      env: { ...process.env, PTC_WEB_REPAIR_FIXTURE_ORIGIN: fixture.origin },
      maxBuffer: 4 * 1024 * 1024,
    })
  } catch (error) {
    throw new Error(`ptc ${args[0]}: ${error.stderr || error.message}`)
  }
}
async function stage(phase, input, descriptor = active?.descriptor) {
  const id = `${String(++sequence).padStart(2, '0')}-${phase}`
  const inputPath = join(output, `${id}-input.json`)
  const envelopePath = join(output, `${id}-envelope.json`)
  const privatePath = join(output, `${id}-private.json`)
  await save(inputPath, { phase, ...input })
  const start = performance.now()
  let commandError
  try {
    await ptc([
      'run',
      phase === 'repair' ? join(projectDirectory, 'repair-project.json') : project,
      '--env-file',
      resolve(envFile),
      '--input',
      inputPath,
      '--envelope',
      envelopePath,
      ...(phase === 'repair' ? ['--host-config', repairHost, '--private-output', privatePath] : []),
      ...(descriptor ? ['--component-override-descriptor', descriptor] : []),
    ])
  } catch (error) {
    commandError = error
  }
  let envelope
  try {
    envelope = JSON.parse(await readFile(envelopePath, 'utf8'))
  } catch {
    /* retain command failure */
  }
  const usage = envelope?.execution?.usage
  const llm = usage?.llm_usage ?? []
  const row = {
    id,
    phase,
    run_ref: envelope?.run_ref,
    status: envelope?.status ?? 'command_failed',
    wall_ms: Math.round(performance.now() - start),
    model_calls: llm.reduce((n, item) => n + item.calls, 0),
    input_tokens: llm.reduce((n, item) => n + (item.usage?.input ?? 0), 0),
    output_tokens: llm.reduce((n, item) => n + (item.usage?.output ?? 0), 0),
    cost_microusd: llm.reduce((n, item) => n + (item.usage?.total_cost?.microunits ?? 0), 0),
    usage_available: usage?.llm_usage_state === 'available' && llm.every((item) => item.missing_usage_calls === 0),
    capability_calls: usage?.capability_calls ?? {},
    models: usage?.llm_usage_by_model?.map((item) => item.resolved_model) ?? [],
  }
  stages.push(row)
  if (phase === 'failure') {
    assert.equal(envelope?.status, 'error')
    assert.match(JSON.stringify(envelope), /explicit_failure/)
    return { row }
  }
  if (commandError) throw commandError
  assert.equal(envelope.status, 'ok')
  if (phase !== 'repair') assert.equal(row.model_calls, 0, 'Models must only run in the repair phase')
  else assert.ok(row.model_calls >= 2 && row.model_calls <= 8)
  const value = phase === 'repair' ? JSON.parse(await readFile(privatePath, 'utf8')) : envelope.result.value
  const resultPath = join(output, `${id}-result.json`)
  await save(resultPath, value)
  return { value, row, resultPath }
}
async function inspect(result) {
  const runRef = result.row.run_ref
  const { stdout } = await ptc([
    'repl',
    '--profile',
    'private-run-analysis-v2',
    '--run',
    runRef,
    '--resource',
    `traces=${projectDirectory}/.ptc/traces`,
    '--resource',
    `inspection=${projectDirectory}/.ptc/inspection`,
    '--session-trace-dir',
    join(output, 'analysis'),
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
  const names =
    result.row.phase === 'probe'
      ? ['page_open', 'page_capture', 'page_read', 'page_extract', 'page_close']
      : ['page_open', 'page_capture', 'page_extract', 'page_close']
  assert.deepEqual(
    page.items.map((item) => item.request.params.name),
    names,
  )
  for (const exchange of page.items) {
    assert.equal(exchange.response.id, exchange.request.id)
    assert.equal(exchange.response.error, undefined)
    assert.notEqual(exchange.response.result.isError, true)
    assert.equal(exchange.response.result.resultType, 'complete')
  }
  await save(join(output, `${result.row.id}-exchanges.json`), page)
  result.row.inspected_mcp_calls = page.items.length
  return page.items.map((item) => ({ tool: item.request.params.name, arguments: item.request.params.arguments }))
}
async function materialize(sourceArgs, name) {
  const candidate = join(output, name)
  await ptc([
    'materialize',
    project,
    '--target-mission',
    'browser',
    '--component',
    'site.recipe',
    ...sourceArgs,
    '--out',
    candidate,
  ])
  const descriptor = join(candidate, 'descriptor.json')
  await ptc(['validate', project, '--component-override-descriptor', descriptor])
  return { descriptor, source: await readFile(join(candidate, 'candidate.clj'), 'utf8') }
}

async function verifyDebugReads(learned, runRefs) {
  await auditDebugReads({ ptc, projectDirectory, output, id: learned.row.id, runRef: learned.row.run_ref, runRefs })
  learned.row.debug_reads_verified = true
}

try {
  const manifest = JSON.parse(await readFile(join(learning, 'ptc.json'), 'utf8'))
  manifest.workflow.components[0].id = 'repair.workflow'
  manifest.workflow.components = [
    { id: 'repair.workflow', path: 'workflow.clj', dependencies: ['agent.core', 'kernel'] },
    { library: 'agent.core' },
    { library: 'kernel' },
  ]
  manifest.workflow.entry = 'repair.workflow/run'
  // Ordinary runs have no granted LLM. The repair project is
  // selected only after a completed extraction violates the operational contract.
  const normalManifest = structuredClone(manifest)
  normalManifest.providers.workflow = []
  normalManifest.workflow.components = [
    { id: 'repair.query', path: 'query.clj', dependencies: ['kernel'] },
    { library: 'kernel' },
  ]
  normalManifest.workflow.entry = 'repair.query/run'
  manifest.missions = {
    evidence: { components: [{ library: 'debug.nav' }], providers: ['debug.nav', 'failed-run-traces'] },
  }
  manifest.providers.mission = [{ name: 'debug.nav' }, { name: 'failed-run-traces', config: { expose: false } }]
  manifest.contracts = { phase_return_schemas: { recipe: { path: 'recipe.schema.json' } } }
  manifest.events = { policy: 'private' }
  manifest.limits = {
    run_duration_ms: 240000,
    workflow_timeout_ms: 240000,
    evaluation_timeout_ms: 30000,
    workflow_capability_calls: 64,
    mission_capability_calls: 32,
    subordinate_evaluations: 8,
    llm_request_output_tokens: 2048,
    normal_event_count: 1024,
  }
  const host = JSON.parse(await readFile(join(learning, 'ptc-host.json'), 'utf8'))
  host.credentials.fixture_origin = { env: 'PTC_WEB_REPAIR_FIXTURE_ORIGIN' }
  host.install.web.transport.command = process.execPath
  host.install.web.transport.cwd = root
  host.install.web.transport.env = { PTC_WEB_ALLOW_LOCAL_ORIGINS: { binding: 'fixture_origin' } }
  for (const name of ['browser.clj', 'site.clj']) {
    await writeFile(join(projectDirectory, name), await readFile(join(learning, name)), { mode: 0o600 })
  }
  for (const name of ['workflow.clj', 'query.clj']) {
    await writeFile(join(projectDirectory, name), await readFile(join(directory, name)), { mode: 0o600 })
  }
  await save(join(projectDirectory, 'ptc.json'), normalManifest)
  await save(join(projectDirectory, 'repair.json'), manifest)
  await save(join(projectDirectory, 'recipe.schema.json'), {
    type: 'object',
    additionalProperties: false,
    properties: Object.fromEntries(
      ['container', 'text_selector', 'author_selector', 'reason'].map((key) => [
        key,
        { type: 'string', minLength: 1, maxLength: key === 'reason' ? 2000 : 512 },
      ]),
    ),
    required: ['container', 'text_selector', 'author_selector', 'reason'],
  })
  await save(join(projectDirectory, 'host.json'), host)
  const projectConfig = {
    kind: 'ptc-project',
    version: 1,
    application: { path: 'ptc.json' },
    host: { path: 'host.json' },
    artifacts: { root: '.ptc', trace: true, inspection: true, result: true, envelope: true },
  }
  await save(project, projectConfig)
  await save(join(projectDirectory, 'repair-project.json'), {
    ...projectConfig,
    application: { path: 'repair.json' },
  })
  await ptc(['version', '--envelope', join(output, 'version.json')])
  version = JSON.parse(await readFile(join(output, 'version.json'), 'utf8')).result
  await ptc(['validate', project])
  active = await materialize(['--source', join(learning, 'recipes/quotes.clj')], 'initial')

  for (const [index, revision] of [1, 1, 2, 2, 3, 3].entries()) {
    fixture.change(revision)
    evidence = null
    const start = performance.now()
    const startCalls = modelAttempts
    const startModelCalls = stages.reduce((n, row) => n + row.model_calls, 0)
    const item = { query: index + 1, revision, recipe_before: active.descriptor }
    queries.push(item)
    console.log(`Query ${index + 1}: layout v${revision}`)
    const completed = await queryWithRepair({
      active,
      query: async (candidate) => {
        const result = await stage('query', { url: `${fixture.origin}/quotes` }, candidate.descriptor)
        item.initial_errors = extractionErrors(result.value)
        item.initial_accuracy = accuracy(result.value.extraction.records, expected['/quotes'])
        await inspect(result)
        return result
      },
      propose: async ({ active: prior, first, errors, attempt, attempts }) => {
        if (modelAttempts >= 4) throw new Error('Global model-attempt limit reached')
        if (!evidence) {
          const failed = await stage('failure', { query_run: first.row.run_ref, errors, observed: first.value }, null)
          evidence = await stage('probe', { url: `${fixture.origin}/quotes` }, prior.descriptor)
          await inspect(evidence)
          assert.equal(evidence.value.markdown.next_cursor, null)
          const capture = join(output, `evidence-${index + 1}`)
          for (const name of ['traces', 'inspection'])
            await mkdir(join(capture, name), { recursive: true, mode: 0o700 })
          const runRefs = [first.row.run_ref, failed.row.run_ref, evidence.row.run_ref]
          for (const runRef of runRefs) {
            await copyFile(
              join(projectDirectory, '.ptc/traces', `${runRef}.jsonl`),
              join(capture, 'traces', `${runRef}.jsonl`),
            )
            await copyFile(
              join(projectDirectory, '.ptc/inspection', `${runRef}.ptcins`),
              join(capture, 'inspection', `${runRef}.ptcins`),
            )
          }
          const debugHost = structuredClone(host)
          delete debugHost.install.web
          debugHost.install['failed-run-traces'] = {
            source: 'ptc_private_trace_snapshot',
            installation_revision: 'repair-traces-v1',
            directory: join(capture, 'traces'),
          }
          debugHost.install['debug.nav'] = {
            source: 'ptc_inspection_snapshot',
            installation_revision: 'repair-inspection-v1',
            directory: join(capture, 'inspection'),
          }
          Object.assign(debugHost.install.deepseek, {
            model: primaryModel,
            structured_output_mode: 'unsupported',
            accepts_data: ['normal', 'private_inspection'],
            params: { max_tokens: 2048, temperature: 0 },
          })
          repairHost = join(output, `debug-host-${index + 1}.json`)
          repairHostConfiguration = debugHost
          await save(repairHost, debugHost)
          evidence.runRefs = {
            failure_run: failed.row.run_ref,
            query_run: first.row.run_ref,
            probe_run: evidence.row.run_ref,
          }
          await ptc(['validate', join(projectDirectory, 'repair-project.json'), '--host-config', repairHost])
        }
        console.log(`  Validation failed (${errors.join(', ')}); repair attempt ${attempt}`)
        modelAttempts++
        if (attempt > 1) {
          const fallbackHost = structuredClone(repairHostConfiguration)
          fallbackHost.install.deepseek.model = 'openrouter:google/gemini-3.7-flash'
          fallbackHost.install.deepseek.installation_revision = 'repair-gemini-fallback-v1'
          repairHost = join(output, `debug-host-fallback-${index + 1}.json`)
          await save(repairHost, fallbackHost)
          console.log('  Retrying investigation with google/gemini-3.7-flash')
        }
        let learned
        try {
          learned = await stage(
            'repair',
            { ...evidence.runRefs, previous_attempts: attempts.map((entry) => ({ errors: entry.errors })) },
            null,
          )
        } catch (error) {
          if (controller.signal.aborted) throw error
          return { candidate: null, errors: [`investigation_failed: ${error.message}`] }
        }
        try {
          assert.ok(
            (learned.row.capability_calls['mission/debug.nav.read'] ?? 0) >= 3,
            'Repair agent must actually navigate debug evidence',
          )
          assert.ok(learned.value.debug_programs.some((program) => program.source.includes('debug.nav/read')))
          await verifyDebugReads(learned, evidence.runRefs)
          assert.ok(learned.value.component_source.length < 8000)
          const candidate = await materialize(
            ['--from-result', learned.resultPath, '--result-pointer', '/component_source'],
            `candidate-${modelAttempts}`,
          )
          candidate.recipe = learned.value.recipe
          return { candidate }
        } catch (error) {
          return { candidate: null, errors: [`candidate_rejected: ${error.message}`] }
        }
      },
      verify: async (candidate) => {
        const errors = []
        let original
        // The model never sees held-out HTML, records or expected answers.
        for (const path of ['/quotes', '/held-out']) {
          const checked = await stage('verify', { url: `${fixture.origin}${path}` }, candidate.descriptor)
          await inspect(checked)
          const contract = extractionErrors(checked.value)
          const score = accuracy(checked.value.extraction.records, expected[path])
          checked.row.accuracy = score
          if (contract.length || !score.exact)
            errors.push(`${path === '/quotes' ? 'probe' : 'held_out'}_validation_failed`)
          if (path === '/quotes') original = checked
        }
        return { errors, result: original }
      },
    })
    active = completed.active
    Object.assign(item, {
      repaired: completed.repaired,
      attempts: completed.attempts,
      repair_attempts: modelAttempts - startCalls,
      model_calls: stages.reduce((n, row) => n + row.model_calls, 0) - startModelCalls,
      final_accuracy: accuracy(completed.result.value.extraction.records, expected['/quotes']),
      wall_ms: Math.round(performance.now() - start),
      recipe_after: active.descriptor,
    })
    assert.equal(item.final_accuracy.exact, true)
    await save(join(output, `accepted-after-query-${index + 1}.json`), active)
    console.log(
      `  Exact records: ${item.final_accuracy.correct}/${item.final_accuracy.expected}; model calls: ${item.model_calls}`,
    )
  }
  assert.deepEqual(
    queries.map((item) => item.repaired),
    [false, false, true, false, true, false],
  )
} catch (error) {
  failure = error.message
  if (queries.length && error.attempts) queries.at(-1).attempts = error.attempts
  console.error(failure)
  process.exitCode = 1
} finally {
  await fixture.close()
  clearTimeout(deadline)
  process.removeListener('SIGINT', abort)
  process.removeListener('SIGTERM', abort)
  const sum = (field) => stages.reduce((n, row) => n + row[field], 0)
  const report = {
    status: failure ? 'failed' : 'passed',
    failure,
    ptc: version,
    wall_ms: Math.round(performance.now() - started),
    stats: {
      queries: queries.length,
      successful_queries: queries.filter((q) => q.final_accuracy?.exact).length,
      repair_events: queries.filter((q) => q.repaired).length,
      model_attempts: modelAttempts,
      model_calls: sum('model_calls'),
      input_tokens: sum('input_tokens'),
      output_tokens: sum('output_tokens'),
      cost_microusd: sum('cost_microusd'),
      usage_complete: stages.every((row) => row.usage_available),
      mcp_calls_inspected: stages.reduce((n, row) => n + (row.inspected_mcp_calls ?? 0), 0),
    },
    queries,
    stages,
    active_recipe: active,
    fixture_requests: fixture.requests,
    fixture_closed: true,
    limits: { max_attempts_per_error: 2, max_model_attempts: 4, experiment_timeout_ms: 600000 },
  }
  await save(join(output, 'report.json'), report)
  await writeFile(
    join(output, 'queries.csv'),
    'query,revision,repaired,model_calls,wall_ms,precision,recall\n' +
      queries
        .map((q) =>
          [
            q.query,
            q.revision,
            q.repaired ?? false,
            q.model_calls ?? '',
            q.wall_ms ?? '',
            q.final_accuracy?.precision ?? '',
            q.final_accuracy?.recall ?? '',
          ].join(','),
        )
        .join('\n') +
      '\n',
    { mode: 0o600 },
  )
  console.log(
    JSON.stringify({ status: report.status, stats: report.stats, report: join(output, 'report.json') }, null, 2),
  )
}
