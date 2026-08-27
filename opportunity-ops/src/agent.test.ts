import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runOpportunity } from './agent.js'
import type { SourceSnapshot, UserProfile } from './domain.js'

const profile: UserProfile = { name: 'Test', interests: ['agentic'], technologies: ['Gemini'], location: 'UK', availableHours: 10 }
const source = (text: string): SourceSnapshot => ({ url: 'https://fixture.test/opportunity', version: '1', fetchedAt: new Date().toISOString(), text })

test('vertical slice extracts, plans, executes, and verifies', async () => {
  const run = await runOpportunity(source('title: Agent Challenge\ndeadline: 2026-12-31T00:00:00+00:00\nrequired: Gemini\ndeliverable: demo'), profile)
  assert.equal(run.status, 'verified'); assert.ok(run.plan); assert.ok(run.events.some(e => e.type === 'VERIFICATION_PASSED'))
})

test('malformed source fails closed instead of guessing', async () => {
  const run = await runOpportunity(source('title: Missing deadline\nrequired: Gemini'), profile)
  assert.equal(run.status, 'failed'); assert.match(run.events.at(-1)?.data?.error as string, /missing.*deadline/i)
})

test('verifier catches a wrong extracted deadline and blocks action', async () => {
  const snapshot = source('title: Agent Challenge\ndeadline: 2026-08-31T00:00:00+00:00\nrequired: Gemini\ndeliverable: demo')
  const run = await runOpportunity(snapshot, profile, undefined, {
    extract: () => ({
      id: 'wrong', title: 'Agent Challenge', sourceUrl: snapshot.url, deadlineIso: '2026-09-15T00:00:00+00:00', timezone: 'UTC',
      eligibility: [], requiredTechnologies: ['Gemini'], deliverables: ['demo'], judgingCriteria: [],
      citations: { deadline: snapshot.url, requirements: snapshot.url }, sourceVersion: snapshot.version,
    }),
  })
  assert.equal(run.status, 'failed')
  assert.equal(run.events.some(e => e.type === 'ACTION_EXECUTED'), false)
  assert.ok(run.events.some(e => e.type === 'ACTION_BLOCKED'))
  assert.equal(run.evidence[0].sourceValue, '2026-08-31T00:00:00+00:00')
  assert.match(run.evidence[0].reason ?? '', /Source says 2026-08-31/)
})