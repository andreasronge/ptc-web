import assert from 'node:assert/strict'
import test from 'node:test'
import { AccessPolicy, isPublicAddress } from '../../src/access-policy.js'

test('classifies public and non-public addresses conservatively', () => {
  assert.equal(isPublicAddress('93.184.216.34'), true)
  assert.equal(isPublicAddress('127.0.0.1'), false)
  assert.equal(isPublicAddress('10.0.0.1'), false)
  assert.equal(isPublicAddress('169.254.1.1'), false)
  assert.equal(isPublicAddress('::1'), false)
  assert.equal(isPublicAddress('fc00::1'), false)
  assert.equal(isPublicAddress('::ffff:127.0.0.1'), false)
  assert.equal(isPublicAddress('2001:4860:4860::8888'), true)
})

test('allows only an exact configured local origin', async () => {
  const policy = new AccessPolicy(new Set(['http://127.0.0.1:8123']))
  assert.equal((await policy.assertAllowed('http://127.0.0.1:8123/page')).pathname, '/page')
  await assert.rejects(policy.assertAllowed('http://127.0.0.1:8124/page'), /non-public/)
  await assert.rejects(policy.assertAllowed('file:///etc/passwd'), /only HTTP/)
  await assert.rejects(policy.assertAllowed('http://user:secret@example.com/'), /credentials/)
})
