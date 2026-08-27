import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderEvaluationMarkdown, runEvaluation } from './evaluation.js'

test('evaluation mode passes the adversarial suite and renders judge evidence', async () => {
  const report = await runEvaluation()
  assert.equal(report.passed, report.total)
  assert.equal(report.score, 100)
  assert.equal(report.cases.length, 5)
  assert.match(renderEvaluationMarkdown(report), /PASS Deadline conflict/)
  assert.match(renderEvaluationMarkdown(report), /Unsafe actions blocked/)
})