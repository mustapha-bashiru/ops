import type { AgentBlueprint, Run, SubmissionPackage } from './domain.js'

export function createSubmissionPackage(run: Run): SubmissionPackage {
  if (run.status !== 'verified' || !run.opportunity || !run.plan) throw new Error('Cannot create a submission package from an unverified run')
  const opportunity = run.opportunity
  const passedEvidence = run.evidence.filter(item => item.verified).length
  const blueprint: AgentBlueprint = {
    roles: [
      { name: 'Scout', responsibility: 'Fetch, sanitize, hash, and cite the authoritative opportunity source.', tools: ['fetchSourceTool'] },
      { name: 'Planner', responsibility: 'Score fit and convert requirements into milestones with acceptance checks.', tools: ['local planner'] },
      { name: 'Builder', responsibility: 'Create the run-scoped submission artifact after preflight verification.', tools: ['createArtifactTool'] },
      { name: 'Verifier', responsibility: 'Independently compare critical claims against the source before release.', tools: ['evidence checks'] },
      { name: 'Coordinator', responsibility: 'Enforce state transitions, approvals, and an immutable audit trail.', tools: ['event timeline', 'approval policy'] },
    ],
    stateFlow: run.events.filter(event => event.type.startsWith('RUN_')).map(event => event.type.replace('RUN_', '').toLowerCase()),
    guardrails: ['Untrusted source text is data, never instructions.', 'Missing or conflicting deadlines fail closed.', 'External side effects require explicit approval.', 'Blocked runs cannot produce a verified submission package.'],
    evaluationSignals: [
      { name: 'Evidence coverage', value: `${passedEvidence}/${run.evidence.length}`, meaning: 'Critical claims independently checked' },
      { name: 'Fit score', value: `${run.plan.fitScore}/100`, meaning: 'Opportunity alignment with the builder profile' },
      { name: 'Fail-closed path', value: 'available', meaning: 'Unsafe action is blocked before execution' },
      { name: 'Replayability', value: `${run.events.length} events`, meaning: 'Run can be inspected from creation to release' },
    ],
  }
  return {
    title: opportunity.title,
    opportunityUrl: opportunity.sourceUrl,
    executiveSummary: `Build a verified ${opportunity.title} entry focused on ${opportunity.requiredTechnologies.join(', ')}. The plan scores ${run.plan.fitScore}/100 against the current builder profile and reserves time for verification before submission. The differentiator is trustworthy autonomy: the system can move quickly, but it will not turn an unverified claim into an external action.`,
    architecture: ['Scout: ingest and normalize the authoritative opportunity source while preserving an immutable content version.', 'Planner: map requirements to milestones, acceptance checks, and a fit score so effort is spent where it can win.', 'Builder: produce the vertical slice and submission artifact using run-scoped, idempotent writes.', 'Verifier: independently compare critical claims with cited source evidence before release; conflicts fail closed.', 'Audit layer: replay the event timeline so judges can inspect every transition, decision, and blocked action.'],
    blueprint,
    demoScript: ['Show the source, immutable version, and extracted deadline.', 'Show the fit score, requirements coverage, and milestone plan.', 'Open the generated submission brief and point to the architecture and judging map.', 'Run the conflict scenario and show the verifier blocks the action before execution.', 'Replay the audit timeline to prove the system is both autonomous and accountable.'],
    judgingMap: opportunity.judgingCriteria.map(criterion => ({ criterion, proof: `Submission brief and audit timeline demonstrate ${criterion}.` })),
    milestones: run.plan.milestones,
    citations: { ...opportunity.citations, source: opportunity.sourceUrl },
    verification: 'verified',
  }
}

export function renderSubmissionMarkdown(packageData: SubmissionPackage): string {
  return [
    `# ${packageData.title}`, '', packageData.executiveSummary, '',
    '## Why this can win',
    '- Fast: converts a messy opportunity page into an actionable build plan.',
    '- Trustworthy: every critical claim has source evidence and conflicts fail closed.',
    '- Demonstrable: the same run produces a replayable timeline and judge-ready artifact.', '',
    '## Agent blueprint',
    ...packageData.blueprint.roles.map(role => `- **${role.name}** - ${role.responsibility} Tools: ${role.tools.join(', ')}.`), '',
    '**State flow:**', packageData.blueprint.stateFlow.map(state => `- ${state}`).join('\n'), '',
    '## Guardrails', ...packageData.blueprint.guardrails.map(item => `- ${item}`), '',
    '## Evaluation signals', ...packageData.blueprint.evaluationSignals.map(signal => `- **${signal.name}:** ${signal.value} - ${signal.meaning}`), '',
    '## Architecture', ...packageData.architecture.map(item => `- ${item}`), '',
    '## Demo script', ...packageData.demoScript.map((item, index) => `${index + 1}. ${item}`), '',
    '## Judging criteria', ...packageData.judgingMap.map(item => `- **${item.criterion}**: ${item.proof}`), '',
    '## Milestones', ...packageData.milestones.map(item => `- ${item.title}: ${item.dueIso}`), '',
    '## Citations', ...Object.entries(packageData.citations).map(([label, citation]) => `- ${label}: ${citation}`), '',
  ].join('\n')
}