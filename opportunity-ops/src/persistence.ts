import { Firestore } from '@google-cloud/firestore'
import { Storage } from '@google-cloud/storage'
import { createHash } from 'node:crypto'
import type { Run, SourceSnapshot } from './domain.js'

export type StoredArtifact = { runId: string; name: string; content: string; contentHash: string }

export interface RunPersistence {
  saveSnapshot(snapshot: SourceSnapshot): Promise<void>
  saveRun(run: Run): Promise<void>
  saveArtifact(artifact: StoredArtifact): Promise<{ key: string; created: boolean }>
}

export class MemoryRunPersistence implements RunPersistence {
  readonly snapshots = new Map<string, SourceSnapshot>()
  readonly runs = new Map<string, Run>()
  readonly artifacts = new Map<string, StoredArtifact>()

  async saveSnapshot(snapshot: SourceSnapshot): Promise<void> { this.snapshots.set(snapshot.version, structuredClone(snapshot)) }
  async saveRun(run: Run): Promise<void> { this.runs.set(run.id, structuredClone(run)) }
  async saveArtifact(artifact: StoredArtifact): Promise<{ key: string; created: boolean }> {
    const key = `${artifact.runId}/${artifact.name}`
    if (this.artifacts.has(key)) return { key, created: false }
    this.artifacts.set(key, structuredClone(artifact))
    return { key, created: true }
  }
}

export function memoryArtifact(persistence: RunPersistence | undefined, runId: string, name: string): string | undefined {
  if (!(persistence instanceof MemoryRunPersistence)) return undefined
  return persistence.artifacts.get(`${runId}/${name}`)?.content
}

export type CloudPersistenceOptions = { projectId?: string; firestore?: Firestore; storage?: Storage; bucket?: string; runsCollection?: string; snapshotsPrefix?: string; artifactsPrefix?: string }

export class GoogleCloudRunPersistence implements RunPersistence {
  private readonly firestore: Firestore
  private readonly storage: Storage
  private readonly bucket: string
  private readonly runsCollection: string
  private readonly snapshotsPrefix: string
  private readonly artifactsPrefix: string

  constructor(options: CloudPersistenceOptions = {}) {
    this.firestore = options.firestore ?? new Firestore({ projectId: options.projectId ?? process.env.GOOGLE_CLOUD_PROJECT })
    this.storage = options.storage ?? new Storage({ projectId: options.projectId ?? process.env.GOOGLE_CLOUD_PROJECT })
    this.bucket = options.bucket ?? process.env.OPPORTUNITY_OPS_BUCKET ?? ''
    this.runsCollection = options.runsCollection ?? 'opportunityRuns'
    this.snapshotsPrefix = options.snapshotsPrefix ?? 'snapshots'
    this.artifactsPrefix = options.artifactsPrefix ?? 'artifacts'
    if (!this.bucket) throw new Error('Cloud persistence requires OPPORTUNITY_OPS_BUCKET')
  }

  async saveSnapshot(snapshot: SourceSnapshot): Promise<void> {
    await this.writeImmutable(`${this.snapshotsPrefix}/${snapshot.version}.txt`, snapshot.text, { sourceUrl: snapshot.url, fetchedAt: snapshot.fetchedAt, sourceVersion: snapshot.version })
  }

  async saveRun(run: Run): Promise<void> {
    await this.firestore.collection(this.runsCollection).doc(run.id).set({ ...run, updatedAt: new Date().toISOString() })
  }

  async saveArtifact(artifact: StoredArtifact): Promise<{ key: string; created: boolean }> {
    const key = `${this.artifactsPrefix}/${artifact.runId}/${artifact.name}`
    return this.writeImmutable(key, artifact.content, { runId: artifact.runId, contentHash: artifact.contentHash })
  }

  private async writeImmutable(name: string, content: string, metadata: Record<string, string>): Promise<{ key: string; created: boolean }> {
    const file = this.storage.bucket(this.bucket).file(name)
    try {
      await file.save(content, { resumable: false, metadata: { metadata }, preconditionOpts: { ifGenerationMatch: 0 } })
      return { key: name, created: true }
    } catch (error) {
      if (error instanceof Error && /generation|already exists|precondition/i.test(error.message)) return { key: name, created: false }
      throw error
    }
  }
}

export function artifactRecord(runId: string, name: string, content: string): StoredArtifact {
  return { runId, name, content, contentHash: createHash('sha256').update(content).digest('hex') }
}