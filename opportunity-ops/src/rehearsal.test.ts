import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderRehearsalMarkdown, runRehearsal } from './rehearsal.js'

test('judge rehearsal proves both capability and restraint', async () => {
  const report = await runRehearsal()
  assert.equal(report.verified.run.status, 'verified')
  assert.equal(report.blocked.run.status, 'failed')
  assert.ok(report.verified.run.events.some(event => event.type === 'SUBMISSION_PACKAGE_CREATED'))
  assert.ok(report.blocked.run.events.some(event => event.type === 'VERIFICATION_FAILED'))
  assert.ok(report.blocked.run.events.some(event => event.type === 'ACTION_BLOCKED'))
  assert.ok(!report.blocked.run.events.some(event => event.type === 'ACTION_EXECUTED'))
  const markdown = renderRehearsalMarkdown(report)
  assert.match(markdown, /3-Minute Judge Rehearsal/)
  assert.match(markdown, /VERIFICATION_FAILED/)
  assert.match(markdown, /ACTION_BLOCKED/)
  assert.match(markdown, /Score: 5\/5 \(100%\)/)
})