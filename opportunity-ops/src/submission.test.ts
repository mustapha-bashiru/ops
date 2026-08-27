import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSubmissionPackage, renderSubmissionMarkdown } from './submission.js'
import type { Run } from './domain.js'

const run: Run = {
  id: 'run-1', status: 'verified', evidence: [], events: [], approvals: [],
  opportunity: { id: 'opp-1', title: 'Agent Challenge', sourceUrl: 'https://example.test/challenge', deadlineIso: '2027-01-01T00:00:00+00:00', timezone: 'UTC', eligibility: [], requiredTechnologies: ['Gemini'], deliverables: ['demo'], judgingCriteria: ['innovation'], citations: { deadline: 'https://example.test/challenge' }, sourceVersion: 'v1' },
  plan: { opportunityId: 'opp-1', fitScore: 70, rationale: [], stale: false, milestones: [{ id: 'm1', title: 'Build', dueIso: '2026-12-30T00:00:00.000Z', acceptance: ['Artifact exists'], status: 'pending' }] },
}

test('submission package preserves citations and renders a judge-ready brief', () => {
  const packageData = createSubmissionPackage(run)
  assert.equal(packageData.verification, 'verified')
  assert.equal(packageData.citations.deadline, run.opportunity?.sourceUrl)
  assert.match(renderSubmissionMarkdown(packageData), /Agent Challenge/)
  assert.match(renderSubmissionMarkdown(packageData), /innovation/)
  assert.equal(packageData.blueprint.roles.length, 5)
  assert.deepEqual(packageData.blueprint.evaluationSignals[0], { name: 'Evidence coverage', value: '0/0', meaning: 'Critical claims independently checked' })
  assert.match(renderSubmissionMarkdown(packageData), /## Agent blueprint/)
  assert.match(renderSubmissionMarkdown(packageData), /## Evaluation signals/)
})

test('submission package refuses blocked runs', () => {
  assert.throws(() => createSubmissionPackage({ ...run, status: 'failed' }), /unverified/)
})