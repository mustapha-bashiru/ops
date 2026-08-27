import { createHash, randomUUID } from 'node:crypto'
import { OpportunitySchema, type Evidence, type Opportunity, type Plan, type Run, type SourceSnapshot, type UserProfile, assertTransition } from './domain.js'
import { createArtifactTool, fetchSourceTool, inputHash, runTool } from './tools.js'
import type { RunPersistence } from './persistence.js'
import { createSubmissionPackage, renderSubmissionMarkdown } from './submission.js'

const now = () => new Date().toISOString()
function event(run: Run, type: string, actor: string, data?: Record<string, unknown>): void {
  run.events.push({ id: randomUUID(), runId: run.id, type, actor, at: now(), data })
}
function transition(run: Run, status: Run['status']): void { assertTransition(run.status, status); run.status = status; event(run, `RUN_${status.toUpperCase()}`, 'coordinator') }

function sourceDeadline(text: string): string | undefined {
  return text.match(/deadline:\s*(\S+)/i)?.[1] ?? text.match(/(?:endDate|end_date)"?\s*:\s*"([^"\s]+)"/i)?.[1]
}

function canonicalDeadline(value: string | undefined): string | undefined {
  if (!value) return undefined
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString()
}

function extract(snapshot: SourceSnapshot): Opportunity {
  const text = snapshot.text
  const deadline = canonicalDeadline(sourceDeadline(text))
  const title = text.match(/^title:\s*(.+)$/im)?.[1]?.replace(/\s+-\s+Devpost\s*$/i, '').trim()
  if (!deadline || !title) throw new Error('Source is missing a verifiable title or deadline')
  const requiredTechnologies = [...text.matchAll(/required:\s*([^\n]+)/gi)].map(m => m[1].trim().split(/,\s*/)).flat()
  for (const technology of ['Gemini', 'Google ADK', 'Google Cloud']) if (new RegExp(`\\b${technology.replace(' ', '\\s+')}\\b`, 'i').test(text) && !requiredTechnologies.some(item => item.toLowerCase() === technology.toLowerCase())) requiredTechnologies.push(technology)
  const deliverables = [...text.matchAll(/deliverable:\s*([^\n]+)/gi)].map(m => m[1].trim())
  const eligibility = [...text.matchAll(/eligible:\s*([^\n]+)/gi)].map(m => m[1].trim())
  const criteria = [...text.matchAll(/judging:\s*([^\n]+)/gi)].map(m => m[1].trim())
  return OpportunitySchema.parse({ id: createHash('sha1').update(snapshot.url).digest('hex').slice(0, 10), title, sourceUrl: snapshot.url, deadlineIso: deadline, timezone: 'UTC', eligibility, requiredTechnologies, deliverables, judgingCriteria: criteria, citations: { title: snapshot.url, deadline: snapshot.url, requirements: snapshot.url }, sourceVersion: snapshot.version })
}

function plan(opportunity: Opportunity, profile: UserProfile): Plan {
  const technologyFit = opportunity.requiredTechnologies.filter(t => profile.technologies.some(p => p.toLowerCase() === t.toLowerCase())).length
  const interestFit = profile.interests.some(i => opportunity.title.toLowerCase().includes(i.toLowerCase()))
  const score = Math.round(((technologyFit / Math.max(1, opportunity.requiredTechnologies.length)) * 60) + (interestFit ? 40 : 10))
  const deadline = new Date(opportunity.deadlineIso).getTime()
  const day = 86_400_000
  // Reserve one full day after the final milestone for submission and recovery.
  const milestones = ['Research and scope', 'Build vertical slice', 'Verify and record demo'].map((title, i) => ({ id: `m${i + 1}`, title, dueIso: new Date(deadline - (3 - i) * day).toISOString(), acceptance: ['Evidence citation attached', 'Artifact exists', 'Verifier passed'], status: 'pending' as const }))
  return { opportunityId: opportunity.id, fitScore: score, rationale: [`Technology fit: ${technologyFit}/${Math.max(1, opportunity.requiredTechnologies.length)}`, interestFit ? 'Interest matches title' : 'Interest match is weak'], milestones, stale: false }
}

function verify(run: Run, snapshot: SourceSnapshot): Evidence[] {
  const op = run.opportunity!
  const rawDeadline = sourceDeadline(snapshot.text)
  const authoritativeDeadline = canonicalDeadline(rawDeadline)
  const deadlineMatches = authoritativeDeadline === op.deadlineIso
  const checks: Evidence[] = [
    { claim: `Deadline is ${op.deadlineIso}`, citation: op.citations.deadline, verified: Boolean(authoritativeDeadline && deadlineMatches), sourceValue: rawDeadline, reason: deadlineMatches ? undefined : `Source says ${rawDeadline ?? 'no deadline'}` },
    { claim: `Required technologies: ${op.requiredTechnologies.join(', ')}`, citation: op.citations.requirements, verified: op.requiredTechnologies.length > 0 },
    { claim: `Plan has ${run.plan!.milestones.length} milestones`, citation: 'generated://plan', verified: run.plan!.milestones.every(m => new Date(m.dueIso) < new Date(op.deadlineIso)) },
  ]
  return checks
}

export async function runOpportunity(snapshot: SourceSnapshot, profile: UserProfile, approve = (_reason: string) => false, options: { extract?: (snapshot: SourceSnapshot) => Opportunity | Promise<Opportunity>; persistence?: RunPersistence } = {}): Promise<Run> {
  const run: Run = { id: randomUUID(), status: 'created', evidence: [], events: [], approvals: [] }
  event(run, 'RUN_CREATED', 'coordinator', { source: snapshot.url, inputHash: inputHash(snapshot) })
  if (options.persistence) await options.persistence.saveSnapshot(snapshot)
  try {
    const fetched = await runTool(fetchSourceTool, { snapshot }, { run, approve, persistence: options.persistence })
    event(run, 'SOURCE_FETCHED', 'scout', { version: fetched.version })
    run.opportunity = options.extract ? await options.extract(fetched) : extract(fetched); transition(run, 'extracted'); event(run, 'FACTS_EXTRACTED', 'scout', { citations: Object.keys(run.opportunity.citations), extractor: options.extract ? 'injected' : 'deterministic' })
    run.plan = plan(run.opportunity, profile); transition(run, 'planned'); event(run, 'PLAN_CREATED', 'planner', { fitScore: run.plan.fitScore })
    const preflightEvidence = verify(run, fetched)
    if (preflightEvidence.some(e => !e.verified)) {
      run.evidence = preflightEvidence
      transition(run, 'failed')
      event(run, 'VERIFICATION_FAILED', 'verifier', { reason: 'source_conflict', conflicts: preflightEvidence.filter(e => !e.verified).map(e => ({ claim: e.claim, sourceValue: e.sourceValue, reason: e.reason })) })
      event(run, 'ACTION_BLOCKED', 'policy', { reason: 'Verification failed before external action' })
      if (options.persistence) await options.persistence.saveRun(run)
      return run
    }
    await runTool(createArtifactTool, { name: 'submission-brief.md', content: `# ${run.opportunity.title}\n\nFit score: ${run.plan.fitScore}` }, { run, approve, persistence: options.persistence })
    transition(run, 'executed'); event(run, 'ACTION_EXECUTED', 'operator', { idempotencyKey: `${run.id}/submission-brief.md` })
    run.evidence = verify(run, fetched); transition(run, 'verified'); event(run, 'VERIFICATION_PASSED', 'verifier', { passed: run.evidence.filter(e => e.verified).length, total: run.evidence.length })
    const submission = createSubmissionPackage(run)
    await runTool(createArtifactTool, { name: 'submission-package.md', content: renderSubmissionMarkdown(submission) }, { run, approve, persistence: options.persistence })
    event(run, 'SUBMISSION_PACKAGE_CREATED', 'coordinator', { artifact: `${run.id}/submission-package.md` })
  } catch (error) { run.status = 'failed'; event(run, 'RUN_FAILED', 'coordinator', { error: error instanceof Error ? error.message : String(error) }) }
  if (options.persistence) await options.persistence.saveRun(run)
  return run
}