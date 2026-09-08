import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

export async function auditDebugReads({ ptc, projectDirectory, output, id, runRef, runRefs }) {
  const expression = `(let [p (analysis/read "${runRef}" {"collection" "capability_calls" "limit" 100})]
    (assoc p "items" (map (fn [c] {"name" (get c "name") "arguments" (get c "arguments")
      "status" (get-in c ["result" "status"]) "items_read" (count (get-in c ["result" "value" "items"]))}) (get p "items"))))`
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
    expression,
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
  for (const [target, collection] of [
    [runRefs.failure_run, 'execution_errors'],
    [runRefs.query_run, 'provider_exchanges'],
    [runRefs.probe_run, 'provider_exchanges'],
  ]) {
    assert.ok(
      page.items.some(
        (item) =>
          item.name === 'debug.nav.read' &&
          item.arguments.run_id === target &&
          item.arguments.collection === collection &&
          item.status === 'ok' &&
          item.items_read > 0,
      ),
      `Agent did not successfully read ${collection} for ${target}`,
    )
  }
  await writeFile(join(output, `${id}-debug-audit.json`), JSON.stringify(page, null, 2) + '\n', {
    mode: 0o600,
    flag: 'wx',
  })
  return page
}

// Also audit an existing experiment without repeating browser/model work.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const reportPath = resolve(process.argv[2])
  const output = dirname(reportPath)
  const report = JSON.parse(await readFile(reportPath, 'utf8'))
  const execute = promisify(execFile)
  for (const stage of report.stages.filter((row) => row.phase === 'repair' && row.status === 'ok')) {
    const runRefs = JSON.parse(await readFile(join(output, `${stage.id}-input.json`), 'utf8'))
    await auditDebugReads({
      ptc: (args) => execute('ptc', args, { timeout: 30000, maxBuffer: 4 * 1024 * 1024 }),
      projectDirectory: join(output, 'project'),
      output,
      id: `${stage.id}-reaudit`,
      runRef: stage.run_ref,
      runRefs,
    })
    console.log(`${stage.id}: verified agent read the failure, failed extraction and current HTML using debug.nav`)
  }
}
