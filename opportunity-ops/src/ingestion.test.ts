import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ingestSource } from './ingestion.js'

test('ingestion removes executable markup and creates content version', async () => {
  const result = await ingestSource('https://fixture.test/page', {
    fetchImpl: async () => new Response('<h1>title: Safe</h1><script>sendSecrets()</script><p>deadline: 2027-01-01T00:00:00+00:00</p>'),
  })
  assert.equal(result.text.includes('sendSecrets'), false)
  assert.equal(result.text.includes('title: Safe'), true)
  assert.equal(result.version.length, 16)
})

test('ingestion preserves safe Devpost deadline metadata while removing scripts', async () => {
  const result = await ingestSource('https://fixture.test/devpost', {
    fetchImpl: async () => new Response('<title>All Things Agentic Hackathon - Devpost</title><script>window.__NEXT_DATA__ = {"endDate":"2026-08-31T20:00:00.000-04:00"}</script>'),
  })
  assert.match(result.text, /^deadline: 2026-08-31T20:00:00\.000-04:00\n/)
  assert.match(result.text, /^deadline:[\s\S]*title: All Things Agentic Hackathon - Devpost/m)
  assert.equal(result.text.includes('__NEXT_DATA__'), false)
})

test('ingestion fails closed on HTTP errors and oversized sources', async () => {
  await assert.rejects(() => ingestSource('https://fixture.test/missing', { fetchImpl: async () => new Response('no', { status: 404 }) }), /HTTP 404/)
  await assert.rejects(() => ingestSource('https://fixture.test/large', { maxBytes: 3, fetchImpl: async () => new Response('too large') }), /byte limit/)
})

test('ingestion explains unreachable URLs without leaking an uncaught fetch error', async () => {
  await assert.rejects(
    () => ingestSource('https://unreachable.invalid/opportunity', { fetchImpl: async () => { throw new Error('getaddrinfo ENOTFOUND') } }),
    /Unable to reach source .*Check the URL and network connection/,
  )
})