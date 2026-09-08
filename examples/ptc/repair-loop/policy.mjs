// The operational contract detects broken output without knowing fixture answers.
export function extractionErrors(value) {
  const result = value?.extraction
  if (!result || !Array.isArray(result.records)) return ['missing_extraction']
  const errors = []
  if (value.closed !== true) errors.push('handle_not_closed')
  if (result.records.length < 2) errors.push('too_few_records')
  if (result.result_truncated || result.next_cursor != null || result.omitted_records !== 0)
    errors.push('incomplete_result')
  for (const field of ['text', 'author']) {
    if (result.records.some((record) => typeof record[field] !== 'string' || !record[field].trim()))
      errors.push(`missing_${field}`)
  }
  if (new Set(result.records.map((record) => record.text)).size !== result.records.length)
    errors.push('duplicate_text')
  return errors
}

// Exact fixtures are a benchmark oracle, not information sent to the model.
export function accuracy(records, expected) {
  const keys = (rows) => new Set(rows.map((row) => JSON.stringify([row.text, row.author])))
  const actualKeys = keys(records)
  const expectedKeys = keys(expected)
  const correct = [...actualKeys].filter((key) => expectedKeys.has(key)).length
  return {
    correct,
    actual: records.length,
    expected: expected.length,
    precision: records.length ? correct / records.length : 0,
    recall: expected.length ? correct / expected.length : 0,
    exact: correct === records.length && correct === expected.length,
  }
}

// Exceptions (transport, credentials, timeouts) propagate: they are not evidence
// that a selector needs replacing. Only a completed result failing its contract
// enters the repair path. A candidate is never installed before both checks pass.
export async function queryWithRepair({ active, query, propose, verify, maxAttempts = 2 }) {
  const first = await query(active)
  const errors = extractionErrors(first.value)
  if (!errors.length) return { active, result: first, repaired: false, attempts: [] }
  const attempts = []
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const proposal = await propose({ active, first, errors, attempt, attempts })
    if (!proposal.candidate) {
      attempts.push({ attempt, accepted: false, errors: proposal.errors })
      continue
    }
    const checked = await verify(proposal.candidate)
    const accepted = checked.errors.length === 0
    attempts.push({ attempt, accepted, errors: checked.errors })
    if (accepted)
      return { active: proposal.candidate, result: checked.result, repaired: true, attempts, initialErrors: errors }
  }
  const error = new Error(`repair_exhausted after ${maxAttempts} attempts; previous recipe retained`)
  error.attempts = attempts
  error.initialErrors = errors
  throw error
}
