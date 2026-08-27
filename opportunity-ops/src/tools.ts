import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { Run, SourceSnapshot } from './domain.js'
import type { RunPersistence } from './persistence.js'

export type ToolContext = { run: Run; approve: (reason: string) => boolean; persistence?: RunPersistence }
export type ToolDef<I, O> = { name: string; input: z.ZodType<I>; readOnly: boolean; destructive: boolean; externalSideEffect: boolean; execute: (input: I, ctx: ToolContext) => Promise<O> }

export async function runTool<I, O>(tool: ToolDef<I, O>, raw: unknown, ctx: ToolContext): Promise<O> {
  const input = tool.input.parse(raw)
  if ((tool.destructive || tool.externalSideEffect) && !ctx.approve(`Approval required for ${tool.name}`)) {
    throw new Error(`Policy denied tool: ${tool.name}`)
  }
  return tool.execute(input, ctx)
}

export const fetchSourceTool: ToolDef<{ snapshot: SourceSnapshot }, SourceSnapshot> = {
  name: 'fetch_source', input: z.object({ snapshot: z.object({ url: z.string(), version: z.string(), text: z.string(), fetchedAt: z.string() }) }),
  readOnly: true, destructive: false, externalSideEffect: false,
  async execute({ snapshot }) { return snapshot },
}

export const createArtifactTool: ToolDef<{ name: string; content: string }, { key: string; created: boolean }> = {
  name: 'create_run_artifact', input: z.object({ name: z.string().regex(/^[a-z0-9._-]+$/), content: z.string() }),
  readOnly: false, destructive: false, externalSideEffect: false,
  async execute({ name, content }, { run, persistence }) {
    const key = `${run.id}/${name}`
    if (persistence) return persistence.saveArtifact({ runId: run.id, name, content, contentHash: inputHash(content) })
    return { key, created: Boolean(content) }
  },
}

export const createExternalActionTool: ToolDef<{ destination: string; body: string }, { sent: boolean }> = {
  name: 'send_external_action', input: z.object({ destination: z.string(), body: z.string() }),
  readOnly: false, destructive: true, externalSideEffect: true,
  async execute() { return { sent: true } },
}

export function inputHash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16) }