import { runOpportunity } from './agent.js'
import { ingestSource } from './ingestion.js'
import { createExtractorFromEnv } from './providers.js'
import type { Opportunity, SourceSnapshot, UserProfile } from './domain.js'

const fixture: SourceSnapshot = { url: 'https://example.com/all-things-agentic', version: 'fixture-v1', fetchedAt: new Date().toISOString(), text: [
  'title: All Things Agentic Hackathon', 'deadline: 2026-08-31T17:00:00+00:00', 'eligible: adults with internet access',
  'required: Gemini, Google ADK, Google Cloud', 'deliverable: working autonomous agent', 'deliverable: architecture diagram', 'judging: innovation and operational utility',
].join('\n') }
const profile: UserProfile = { name: 'Builder', interests: ['agentic'], technologies: ['Gemini', 'Google ADK', 'Google Cloud'], location: 'UK', availableHours: 20 }
try {
  const snapshot = process.env.SOURCE_URL ? await ingestSource(process.env.SOURCE_URL) : fixture
  // Seeded conflict wins over the model extractor: the point of the scenario is a wrong claim.
  const seedConflict = (source: SourceSnapshot): Opportunity => {
    const sourceDeadline = source.text.match(/deadline:\s*(\S+)/i)?.[1] ?? ''
    const wrongDeadline = new Date(new Date(sourceDeadline).getTime() + 15 * 86_400_000).toISOString()
    return {
      id: 'seeded-conflict', title: 'Seeded deadline conflict', sourceUrl: source.url, deadlineIso: wrongDeadline, timezone: 'UTC',
      eligibility: [], requiredTechnologies: ['Gemini'], deliverables: ['demo'], judgingCriteria: [],
      citations: { deadline: source.url, requirements: source.url }, sourceVersion: source.version,
    }
  }
  const modelExtractor = createExtractorFromEnv()
  const extract = process.env.DEMO_SCENARIO === 'deadline-conflict' ? seedConflict : modelExtractor
  const extractorMode = extract === seedConflict ? 'seeded-conflict' : modelExtractor ? `model (${process.env.GEMINI_MODEL ?? 'default'})` : 'deterministic'
  const run = await runOpportunity(snapshot, profile, undefined, extract ? { extract } : undefined)
  console.log(JSON.stringify({ runId: run.id, status: run.status, extractorMode, fitScore: run.plan?.fitScore, evidence: run.evidence, timeline: run.events.map(e => e.type) }, null, 2))
} catch (error) {
  console.error(`Demo could not ingest SOURCE_URL: ${error instanceof Error ? error.message : String(error)}`)
  console.error('Unset SOURCE_URL to run the deterministic fixture, or provide a reachable HTTPS URL/local file.')
  process.exitCode = 1
}