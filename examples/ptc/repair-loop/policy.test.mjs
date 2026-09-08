import assert from 'node:assert/strict'
import test from 'node:test'
import { load } from 'cheerio'
import { accuracy, extractionErrors, queryWithRepair } from './policy.mjs'
import { expected, render, startChangingFixture } from './fixtures.mjs'

const healthy = () => ({
  value: {
    closed: true,
    extraction: { records: expected['/quotes'], result_truncated: false, next_cursor: null, omitted_records: 0 },
  },
})
const broken = () => ({ value: { ...healthy().value, extraction: { ...healthy().value.extraction, records: [] } } })

test('healthy queries never call the model or change the installed recipe', async () => {
  const active = { id: 'original' }
  const result = await queryWithRepair({
    active,
    query: async () => healthy(),
    propose: async () => assert.fail('model was called'),
    verify: async () => assert.fail('verification was called'),
  })
  assert.equal(result.active, active)
  assert.equal(result.repaired, false)
})

test('transport failures do not trigger selector repair', async () => {
  await assert.rejects(
    queryWithRepair({
      active: {},
      query: async () => {
        throw new Error('navigation timeout')
      },
      propose: async () => assert.fail('model was called'),
    }),
    /navigation timeout/,
  )
})

test('missing fields, silent empty output, duplicates and truncation are detected', () => {
  assert.deepEqual(extractionErrors(broken().value), ['too_few_records'])
  const value = healthy().value
  value.extraction.records = [
    { text: 'A', author: null },
    { text: 'A', author: 'B' },
  ]
  value.extraction.next_cursor = 'more'
  assert.deepEqual(extractionErrors(value), ['incomplete_result', 'missing_author', 'duplicate_text'])
})

test('a held-out failure cannot replace the active recipe and attempts are bounded', async () => {
  const active = { id: 'old' }
  let proposals = 0
  const checked = []
  await assert.rejects(
    queryWithRepair({
      active,
      query: async () => broken(),
      propose: async ({ active: observed }) => {
        assert.equal(observed, active)
        return { candidate: { id: ++proposals } }
      },
      verify: async (candidate) => {
        checked.push(candidate.id)
        return { errors: ['held_out_validation_failed'] }
      },
    }),
    /repair_exhausted after 2 attempts/,
  )
  assert.deepEqual(checked, [1, 2])
  assert.equal(active.id, 'old')
})

test('only a validated candidate is reused, with feedback after a rejected candidate', async () => {
  const candidate = { id: 'new' }
  let proposals = 0
  const repaired = await queryWithRepair({
    active: { id: 'old' },
    query: async () => broken(),
    propose: async ({ attempt, attempts }) => {
      proposals++
      if (attempt === 1) return { candidate: null, errors: ['compile_failed'] }
      assert.deepEqual(attempts[0].errors, ['compile_failed'])
      return { candidate }
    },
    verify: async () => ({ errors: [], result: healthy() }),
  })
  assert.equal(repaired.active, candidate)
  assert.equal(proposals, 2)
  const reused = await queryWithRepair({
    active: repaired.active,
    query: async (active) => {
      assert.equal(active, candidate)
      return healthy()
    },
    propose: async () => assert.fail('model was called'),
  })
  assert.equal(reused.repaired, false)
})

test('oracle detects plausible but wrongly associated records missed by shape checks', () => {
  const value = healthy().value
  value.extraction.records = expected['/quotes'].map((row) => ({ ...row, author: 'Wrong author' }))
  assert.deepEqual(extractionErrors(value), [])
  assert.equal(accuracy(value.extraction.records, expected['/quotes']).exact, false)
})

test('fixture revisions exercise empty and partial failures; held-out wrappers preserve the task', () => {
  const read = (revision, path, container, text, author) => {
    const $ = load(render(revision, path))
    return $(container)
      .toArray()
      .map((node) => ({ text: $(node).find(text).text(), author: $(node).find(author).text() }))
  }
  assert.deepEqual(read(1, '/quotes', '.quote', '.text', '.author'), expected['/quotes'])
  assert.deepEqual(read(2, '/quotes', '.quote', '.text', '.author'), [])
  assert.ok(read(3, '/quotes', '.entry', '.words', '.speaker').every((record) => record.text && !record.author))
  for (const [revision, author] of [
    [2, '.speaker'],
    [3, '.byline'],
  ]) {
    assert.deepEqual(read(revision, '/held-out', '.entry', '.words', author), expected['/held-out'])
  }
})

test('the same URL changes and the local fixture closes cleanly', async () => {
  const fixture = await startChangingFixture()
  try {
    assert.match(await (await fetch(`${fixture.origin}/quotes`)).text(), /class="quote"/)
    fixture.change(2)
    assert.match(await (await fetch(`${fixture.origin}/quotes`)).text(), /class="entry"/)
  } finally {
    await fixture.close()
  }
  await assert.rejects(fetch(`${fixture.origin}/quotes`))
})
