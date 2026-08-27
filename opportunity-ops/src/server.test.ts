import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from './server.js'
import { createServer as createHttpServer } from 'node:http'

test('judge UI serves parseable timeline escape and API runs both paths', async t => {
  const server = createServer().listen(0)
  t.after(() => server.close())
  await new Promise<void>(resolve => server.once('listening', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`
  const html = await (await fetch(base)).text()
  const health = await (await fetch(`${base}/healthz`)).json() as { status: string; service: string }
  assert.deepEqual(health, { status: 'ok', service: 'opportunity-ops' })
  assert.match(html, /onclick="run\(false\)"/)
  assert.ok(html.includes("data.timeline.join('\\n')"), 'timeline separator must remain escaped in browser JavaScript')
  assert.match(html, /Independent-agent scorecard/)
  assert.match(html, /blueprint\.evaluationSignals/)
  assert.match(html, /Run judge rehearsal/)

  const judgeEvidence = await (await fetch(`${base}/api/judge-evidence`)).json() as { evaluation: { score: number }; verified: { run: { status: string; events: string[] } }; blocked: { run: { status: string; events: string[] } } }
  assert.equal(judgeEvidence.evaluation.score, 100)
  assert.equal(judgeEvidence.verified.run.status, 'verified')
  assert.equal(judgeEvidence.blocked.run.status, 'failed')
  assert.ok(judgeEvidence.blocked.run.events.includes('ACTION_BLOCKED'))
  assert.ok(!judgeEvidence.blocked.run.events.includes('ACTION_EXECUTED'))

  const text = 'title: Demo\ndeadline: 2027-01-01T00:00:00+00:00\nrequired: Gemini\ndeliverable: demo'
  const normal = await (await fetch(`${base}/api/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, scenario: 'normal' }) })).json() as { status: string; runId: string; packageUrl: string; packageData: { verification: string } }
  const conflict = await (await fetch(`${base}/api/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, scenario: 'deadline-conflict' }) })).json() as { status: string; timeline: string[] }
  assert.equal(normal.status, 'verified')
  assert.equal(normal.packageData.verification, 'verified')
  assert.equal(normal.packageUrl, `/api/runs/${normal.runId}/submission-package.md`)
  const download = await fetch(`${base}${normal.packageUrl}`)
  assert.equal(download.status, 200)
  assert.match(await download.text(), /## Architecture/)
  assert.equal(conflict.status, 'failed')
  assert.ok(conflict.timeline.includes('ACTION_BLOCKED'))
})

test('browser API ingests a live URL and exposes source provenance', async t => {
  const sourceServer = createHttpServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<html><script>alert(1)</script><h1>title: URL Challenge</h1><p>deadline: 2027-01-01T00:00:00+00:00</p><p>required: Gemini</p></html>')
  }).listen(0)
  t.after(() => sourceServer.close())
  await new Promise<void>(resolve => sourceServer.once('listening', resolve))
  const sourceAddress = sourceServer.address()
  assert.ok(sourceAddress && typeof sourceAddress !== 'string')
  const server = createServer().listen(0)
  t.after(() => server.close())
  await new Promise<void>(resolve => server.once('listening', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const sourceUrl = `http://127.0.0.1:${sourceAddress.port}/challenge`
  const result = await (await fetch(`http://127.0.0.1:${address.port}/api/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: sourceUrl, text: '' }) })).json() as { status: string; sourceMode: string; sourceUrl: string; sourceVersion: string }
  assert.equal(result.status, 'verified')
  assert.equal(result.sourceMode, 'live URL')
  assert.equal(result.sourceUrl, sourceUrl)
  assert.equal(result.sourceVersion.length, 16)
})