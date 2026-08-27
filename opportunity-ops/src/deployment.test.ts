import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'

test('Cloud Run deployment contract targets the portable health endpoint', async () => {
  const [dockerfile, manifest] = await Promise.all([
    readFile(new URL('../Dockerfile', import.meta.url), 'utf8'),
    readFile(new URL('../cloud-run.yaml', import.meta.url), 'utf8'),
  ])
  assert.match(dockerfile, /CMD \["npm", "run", "serve"\]/)
  assert.match(dockerfile, /EXPOSE 8080/)
  assert.match(manifest, /containerPort: 8080/)
  assert.match(manifest, /path: \/healthz/)
  assert.match(manifest, /REGION-docker\.pkg\.dev\/PROJECT\/opportunity-ops\/api:latest/)
})