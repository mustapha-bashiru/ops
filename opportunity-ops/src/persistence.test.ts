import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runOpportunity } from './agent.js'
import { MemoryRunPersistence, artifactRecord } from './persistence.js'
import type { SourceSnapshot, UserProfile } from './domain.js'

const profile: UserProfile = { name: 'Test', interests: ['agentic'], technologies: ['Gemini'], location: 'UK', availableHours: 10 }
const snapshot = (text: string): SourceSnapshot => ({ url: 'https://fixture.test/opportunity', version: 'v1', fetchedAt: new Date().toISOString(), text })

test('memory persistence stores verified run, immutable snapshot, and artifact', async () => {
  const store = new MemoryRunPersistence()
  const run = await runOpportunity(snapshot('title: Agent Challenge\ndeadline: 2027-01-01T00:00:00+00:00\nrequired: Gemini'), profile, undefined, { persistence: store })
  assert.equal(run.status, 'verified')
  assert.equal(store.snapshots.size, 1)
  assert.equal(store.runs.get(run.id)?.status, 'verified')
  assert.deepEqual(store.artifacts.get(`${run.id}/submission-brief.md`)?.content, '# Agent Challenge\n\nFit score: 70')
})

test('memory persistence stores blocked runs and prevents artifact action', async () => {
  const store = new MemoryRunPersistence()
  const source = snapshot('title: Agent Challenge\ndeadline: 2026-08-31T00:00:00+00:00\nrequired: Gemini')
  const run = await runOpportunity(source, profile, undefined, { persistence: store, extract: () => ({
    id: 'wrong', title: 'Agent Challenge', sourceUrl: source.url, deadlineIso: '2026-09-15T00:00:00+00:00', timezone: 'UTC',
    eligibility: [], requiredTechnologies: ['Gemini'], deliverables: ['demo'], judgingCriteria: [],
    citations: { deadline: source.url, requirements: source.url }, sourceVersion: source.version,
  }) })
  assert.equal(run.status, 'failed')
  assert.equal(store.runs.get(run.id)?.status, 'failed')
  assert.equal(store.artifacts.size, 0)
  assert.ok(run.events.some(event => event.type === 'ACTION_BLOCKED'))
})

test('artifact records use a stable content hash', () => {
  const first = artifactRecord('run-1', 'brief.md', 'hello')
  const second = artifactRecord('run-1', 'brief.md', 'hello')
  assert.equal(first.contentHash, second.contentHash)
  assert.equal(first.contentHash.length, 64)
})