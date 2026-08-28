import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile, readdir } from 'node:fs/promises'
import { MINIMUM_GEMINI_GENERATION, geminiGeneration } from './providers.js'

const projectFile = (name: string) => new URL(`../${name}`, import.meta.url)

test('Cloud Run deployment contract targets the portable health endpoint', async () => {
  const [dockerfile, manifest] = await Promise.all([
    readFile(projectFile('Dockerfile'), 'utf8'),
    readFile(projectFile('cloud-run.yaml'), 'utf8'),
  ])
  assert.match(dockerfile, /CMD \["npm", "run", "serve"\]/)
  assert.match(dockerfile, /EXPOSE 8080/)
  assert.match(manifest, /containerPort: 8080/)
  assert.match(manifest, /path: \/healthz/)
  assert.match(manifest, /REGION-docker\.pkg\.dev\/PROJECT\/opportunity-ops\/api:latest/)
})

test('Cloud Run authenticates with workload identity, not a long-lived key', async () => {
  const manifest = await readFile(projectFile('cloud-run.yaml'), 'utf8')
  // The deployed path must obtain a short-lived token from the metadata server.
  assert.match(manifest, /serviceAccountName:/)
  assert.match(manifest, /name: MODEL_MODE\s+value: vertex/)
  // No credential material or secret indirection may appear in the manifest.
  for (const forbidden of [/GEMINI_API_KEY/, /secretKeyRef/, /gemini-api-key/, /GOOGLE_ACCESS_TOKEN/]) {
    assert.doesNotMatch(manifest, forbidden)
  }
})

test('committed configuration and source pin Gemini 3.5 or newer', async () => {
  const sources = (await readdir(new URL('.', import.meta.url))).filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'))
  const targets = [...sources.map(name => `src/${name}`), 'cloud-run.yaml', '.env.example', 'Dockerfile']
  const offenders: string[] = []
  for (const target of targets) {
    const content = await readFile(projectFile(target), 'utf8')
    for (const [literal] of content.matchAll(/gemini-\d+(?:\.\d+)?(?:-[a-z]+)*/gi)) {
      const generation = geminiGeneration(literal.toLowerCase())
      if (generation !== undefined && generation < MINIMUM_GEMINI_GENERATION) offenders.push(`${target}: ${literal}`)
    }
  }
  assert.deepEqual(offenders, [], `pre-${MINIMUM_GEMINI_GENERATION} Gemini model in committed configuration: ${offenders.join(', ')}`)
})
