import { performance } from 'node:perf_hooks'
import { runOpportunity } from './agent.js'
import { renderEvaluationMarkdown, runEvaluation } from './evaluation.js'
import type { Run, SourceSnapshot, UserProfile, Opportunity } from './domain.js'

export type RehearsalPath = { name: string; purpose: string; run: Run; elapsedMs: number; highlights: string[] }
export type RehearsalReport = { generatedAt: string; verified: RehearsalPath; blocked: RehearsalPath; evaluation: Awaited<ReturnType<typeof runEvaluation>> }

const profile: UserProfile = { name: 'Judge Demo', interests: ['agentic'], technologies: ['Gemini', 'Google ADK', 'Google Cloud'], location: 'UK', availableHours: 20 }
const sourceText = ['title: All Things Agentic Hackathon', 'deadline: 2027-12-31T17:00:00+00:00', 'eligible: adults with internet access', 'required: Gemini, Google ADK, Google Cloud', 'deliverable: working autonomous agent', 'deliverable: architecture diagram', 'judging: innovation and operational utility'].join('\n')
const source: SourceSnapshot = { url: 'https://fixture.test/all-things-agentic', version: 'rehearsal-v1', fetchedAt: '2026-08-24T00:00:00.000Z', text: sourceText }

async function timed(work: () => Promise<Run>): Promise<{ run: Run; elapsedMs: number }> {
  const start = performance.now(); const run = await work()
  return { run, elapsedMs: Math.round((performance.now() - start) * 100) / 100 }
}

function highlights(run: Run): string[] {
  return [
    `Status: ${run.status}`,
    `Events: ${run.events.map(event => event.type).join(' -> ')}`,
    `Verified evidence: ${run.evidence.filter(item => item.verified).length}/${run.evidence.length}`,
    `Action executed: ${run.events.some(event => event.type === 'ACTION_EXECUTED') ? 'yes' : 'no'}`,
  ]
}

export async function runRehearsal(): Promise<RehearsalReport> {
  const verified = await timed(() => runOpportunity(source, profile))
  const blocked = await timed(() => runOpportunity(source, profile, undefined, { extract: (snapshot) => ({
    id: 'rehearsal-conflict', title: 'Seeded incorrect claim', sourceUrl: snapshot.url, deadlineIso: '2028-01-15T17:00:00.000Z', timezone: 'UTC', eligibility: [], requiredTechnologies: ['Gemini'], deliverables: ['demo'], judgingCriteria: [], citations: { deadline: snapshot.url }, sourceVersion: snapshot.version,
  } satisfies Opportunity) }))
  return {
    generatedAt: new Date().toISOString(),
    verified: { name: 'Verified path', purpose: 'Show useful autonomous execution with evidence', run: verified.run, elapsedMs: verified.elapsedMs, highlights: highlights(verified.run) },
    blocked: { name: 'Trust path', purpose: 'Show the verifier blocks an incorrect claim before action', run: blocked.run, elapsedMs: blocked.elapsedMs, highlights: highlights(blocked.run) },
    evaluation: await runEvaluation(),
  }
}

export function renderRehearsalMarkdown(report: RehearsalReport): string {
  const path = (item: RehearsalPath) => [`### ${item.name}`, item.purpose, '', ...item.highlights.map(value => `- ${value}`), `- Elapsed: ${item.elapsedMs} ms`, ''].join('\n')
  return [
    '# Opportunity Ops — 3-Minute Judge Rehearsal', '', `Generated: ${report.generatedAt}`, '',
    '## Opening (30 seconds)', '', 'Opportunity Ops turns an untrusted opportunity page into a cited plan and submission artifact. Its differentiator is that the verifier—not the extractor—decides whether an action is safe.', '',
    '## Live demo (90 seconds)', '', '1. Open the local Judge UI and run **Run verified path** using the offline fixture.', '2. Point out source provenance, citations, fit score, replayable timeline, and the downloadable package.', '3. Click **Seed deadline conflict**.', '4. Point out `VERIFICATION_FAILED` and `ACTION_BLOCKED`, and explicitly show that `ACTION_EXECUTED` is absent.', '',
    '## Rehearsal evidence', '', path(report.verified), path(report.blocked),
    '## Adversarial scorecard', '', renderEvaluationMarkdown(report.evaluation),
    '## Architecture close (60 seconds)', '', '- Scout/Extractor: bounded ingestion and structured claims.', '- Planner: fit-scored milestones.', '- Operator: creates only run-local artifacts.', '- Verifier: compares claims against the immutable source snapshot.', '- Policy and persistence boundaries: approval gates, replayable events, and immutable artifacts.', '',
    '## Backup commands', '', '```powershell', 'npm run typecheck', 'npm test', 'npm run evaluate', 'npm run serve', '```', '',
  ].join('\n')
}