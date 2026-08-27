import { z } from 'zod'

export const OpportunitySchema = z.object({
  id: z.string(), title: z.string(), sourceUrl: z.string().url(),
  deadlineIso: z.string().datetime({ offset: true }), timezone: z.string(),
  eligibility: z.array(z.string()), requiredTechnologies: z.array(z.string()),
  deliverables: z.array(z.string()), judgingCriteria: z.array(z.string()),
  citations: z.record(z.string()), sourceVersion: z.string(),
})
export type Opportunity = z.infer<typeof OpportunitySchema>

export type UserProfile = { name: string; interests: string[]; technologies: string[]; location: string; availableHours: number }
export type Milestone = { id: string; title: string; dueIso: string; acceptance: string[]; status: 'pending' | 'complete' | 'blocked' }
export type Plan = { opportunityId: string; fitScore: number; rationale: string[]; milestones: Milestone[]; stale: boolean }
export type Evidence = { claim: string; citation: string; verified: boolean; reason?: string; sourceValue?: string }
export type RunStatus = 'created' | 'extracted' | 'planned' | 'executed' | 'verified' | 'failed'
export type RunEvent = { id: string; runId: string; type: string; actor: string; at: string; inputHash?: string; data?: Record<string, unknown> }
export type Run = { id: string; status: RunStatus; opportunity?: Opportunity; plan?: Plan; evidence: Evidence[]; events: RunEvent[]; approvals: string[] }

export type SourceSnapshot = { url: string; version: string; text: string; fetchedAt: string }
export type AgentBlueprint = {
  roles: { name: string; responsibility: string; tools: string[] }[]
  stateFlow: string[]
  guardrails: string[]
  evaluationSignals: { name: string; value: string; meaning: string }[]
}
export type SubmissionPackage = { title: string; opportunityUrl: string; executiveSummary: string; architecture: string[]; blueprint: AgentBlueprint; demoScript: string[]; judgingMap: { criterion: string; proof: string }[]; milestones: Milestone[]; citations: Record<string, string>; verification: 'verified' }

export function assertTransition(from: RunStatus, to: RunStatus): void {
  const allowed: Record<RunStatus, RunStatus[]> = {
    created: ['extracted', 'failed'], extracted: ['planned', 'failed'], planned: ['executed', 'failed'],
    executed: ['verified', 'failed'], verified: [], failed: [],
  }
  if (!allowed[from].includes(to)) throw new Error(`Invalid run transition: ${from} -> ${to}`)
}