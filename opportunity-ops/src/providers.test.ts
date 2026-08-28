import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_GEMINI_MODEL, GeminiApiProvider, MINIMUM_GEMINI_GENERATION, VertexGeminiProvider, applicationDefaultTokenProvider, assertGeminiCompliance, createOpportunityExtractor, geminiGeneration } from './providers.js'
import { runOpportunity } from './agent.js'
import type { SourceSnapshot, UserProfile } from './domain.js'

const snapshot: SourceSnapshot = { url: 'https://example.com/all-things-agentic', version: 'fixture-v1', fetchedAt: '2026-08-01T00:00:00.000Z', text: [
  'title: All Things Agentic Hackathon', 'deadline: 2026-08-31T17:00:00+00:00', 'eligible: adults with internet access',
  'required: Gemini, Google ADK, Google Cloud', 'deliverable: working autonomous agent', 'judging: innovation and operational utility',
].join('\n') }
const profile: UserProfile = { name: 'Builder', interests: ['agentic'], technologies: ['Gemini', 'Google ADK', 'Google Cloud'], location: 'UK', availableHours: 20 }
const facts = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  title: 'All Things Agentic Hackathon', deadlineIso: '2026-08-31T17:00:00+00:00', timezone: 'UTC',
  eligibility: ['adults with internet access'], requiredTechnologies: ['Gemini', 'Google ADK', 'Google Cloud'],
  deliverables: ['working autonomous agent'], judgingCriteria: ['innovation and operational utility'], ...overrides,
})

test('Vertex provider sends authenticated structured-generation request and validates response shape', async () => {
  let request: Request | undefined
  const provider = new VertexGeminiProvider({ project: 'demo-project', token: 'test-token', model: 'gemini-test', fetchImpl: async (input, init) => {
    request = new Request(input, init)
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }), { headers: { 'x-request-id': 'trace-1' } })
  } })
  const result = await provider.generate({ agent: 'scout', instruction: 'Extract JSON', context: 'source' })
  assert.equal(result.output, '{"ok":true}')
  assert.equal(result.traceId, 'trace-1')
  assert.equal(request?.headers.get('authorization'), 'Bearer test-token')
  assert.equal(JSON.parse(await request!.text()).generationConfig.responseMimeType, 'application/json')
})

test('Vertex provider rejects missing configuration and malformed model output', async () => {
  await assert.rejects(() => new VertexGeminiProvider({}).generate({ agent: 'scout', instruction: 'x', context: 'y' }), /GOOGLE_CLOUD_PROJECT/)
  const provider = new VertexGeminiProvider({ project: 'p', token: 't', fetchImpl: async () => new Response(JSON.stringify({ candidates: [] })) })
  await assert.rejects(() => provider.generate({ agent: 'scout', instruction: 'x', context: 'y' }), /invalid response shape/)
})

test('Gemini API provider requests JSON, fails closed on empty output, and needs a key', async () => {
  let params: { model: string; contents: string; config?: Record<string, unknown> } | undefined
  const provider = new GeminiApiProvider({ apiKey: 'test-key', model: 'gemini-test', generateContent: async input => { params = input; return { text: facts() } } })
  const result = await provider.generate({ agent: 'scout', instruction: 'Extract', context: snapshot.text })
  assert.equal(result.model, 'gemini-test')
  assert.equal(params?.config?.responseMimeType, 'application/json')
  assert.equal(params?.config?.temperature, 0)
  assert.match(params!.contents, /All Things Agentic/)
  await assert.rejects(() => new GeminiApiProvider({ apiKey: 'k', generateContent: async () => ({ text: '  ' }) }).generate({ agent: 'scout', instruction: 'x', context: 'y' }), /empty response/)
  await assert.rejects(() => new GeminiApiProvider({ apiKey: undefined }).generate({ agent: 'scout', instruction: 'x', context: 'y' }), /GEMINI_API_KEY/)
})

test('model extractor stamps provenance from the snapshot and cannot self-assert it', async () => {
  const provider = new GeminiApiProvider({ apiKey: 'k', model: 'gemini-test', generateContent: async () => ({
    // A compromised source could try to redirect citations; those keys are not part of the facts contract.
    text: '```json\n' + facts({ sourceUrl: 'https://attacker.test', sourceVersion: 'forged', citations: { deadline: 'https://attacker.test' } }) + '\n```',
  }) })
  const opportunity = await createOpportunityExtractor(provider)(snapshot)
  assert.equal(opportunity.sourceUrl, snapshot.url)
  assert.equal(opportunity.sourceVersion, snapshot.version)
  assert.deepEqual(Object.values(opportunity.citations), [snapshot.url, snapshot.url, snapshot.url])
  assert.equal(opportunity.deadlineIso, '2026-08-31T17:00:00.000Z')
})

test('model extraction is gated by the deterministic verifier, not trusted on its own', async () => {
  const grounded = new GeminiApiProvider({ apiKey: 'k', generateContent: async () => ({ text: facts() }) })
  const verified = await runOpportunity(snapshot, profile, undefined, { extract: createOpportunityExtractor(grounded) })
  assert.equal(verified.status, 'verified')
  assert.equal(verified.events.find(event => event.type === 'FACTS_EXTRACTED')?.data?.extractor, 'injected')

  const hallucinating = new GeminiApiProvider({ apiKey: 'k', generateContent: async () => ({ text: facts({ deadlineIso: '2026-09-30T17:00:00+00:00' }) }) })
  const blocked = await runOpportunity(snapshot, profile, undefined, { extract: createOpportunityExtractor(hallucinating) })
  assert.equal(blocked.status, 'failed')
  assert.ok(blocked.events.some(event => event.type === 'ACTION_BLOCKED'))
  assert.equal(blocked.evidence.find(item => item.claim.startsWith('Deadline'))?.sourceValue, '2026-08-31T17:00:00+00:00')
})

test('model transport failures fail the run closed instead of proceeding unverified', async () => {
  const broken = new GeminiApiProvider({ apiKey: 'k', generateContent: async () => { throw new Error('quota exhausted') } })
  const run = await runOpportunity(snapshot, profile, undefined, { extract: createOpportunityExtractor(broken) })
  assert.equal(run.status, 'failed')
  assert.match(String(run.events.find(event => event.type === 'RUN_FAILED')?.data?.error), /quota exhausted/)
  assert.equal(run.evidence.length, 0)
})

test('a pre-3.5 Gemini model is rejected on both production paths', async () => {
  assert.equal(MINIMUM_GEMINI_GENERATION, 3.5)
  assert.equal(geminiGeneration('gemini-2.5-flash'), 2.5)
  assert.equal(geminiGeneration('gemini-1.5-pro'), 1.5)
  assert.equal(geminiGeneration('gemini-3.5-flash'), 3.5)
  assert.equal(geminiGeneration('gemini-4-pro'), 4)
  // Aliases we cannot rank pass the runtime gate; deployment.test.ts scans committed config instead.
  assert.equal(geminiGeneration('gemini-test'), undefined)
  assert.ok((geminiGeneration(DEFAULT_GEMINI_MODEL) ?? 0) >= MINIMUM_GEMINI_GENERATION)

  for (const stale of ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-pro']) {
    assert.throws(() => assertGeminiCompliance(stale), /requires Gemini 3\.5 or newer/)
    assert.throws(() => new VertexGeminiProvider({ project: 'p', token: 't', model: stale }), /requires Gemini 3\.5 or newer/)
    assert.throws(() => new GeminiApiProvider({ apiKey: 'k', model: stale }), /requires Gemini 3\.5 or newer/)
  }
  assert.doesNotThrow(() => new VertexGeminiProvider({ project: 'p', token: 't', model: 'gemini-3.5-flash' }))
  assert.doesNotThrow(() => new VertexGeminiProvider({ project: 'p', token: 't', model: 'gemini-4-pro' }))
})

test('Vertex defaults to a compliant model and a stale GEMINI_MODEL cannot downgrade it', async () => {
  const previous = process.env.GEMINI_MODEL
  try {
    delete process.env.GEMINI_MODEL
    let url: string | undefined
    const provider = new VertexGeminiProvider({ project: 'p', token: 't', fetchImpl: async input => {
      url = new Request(input, { method: 'POST', body: '{}' }).url
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{}' }] } }] }))
    } })
    const result = await provider.generate({ agent: 'scout', instruction: 'x', context: 'y' })
    assert.equal(result.model, DEFAULT_GEMINI_MODEL)
    assert.match(url!, /\/models\/gemini-3\.5-flash:generateContent$/)

    process.env.GEMINI_MODEL = 'gemini-2.5-flash'
    assert.throws(() => new VertexGeminiProvider({ project: 'p', token: 't' }), /requires Gemini 3\.5 or newer/)
    assert.throws(() => new GeminiApiProvider({ apiKey: 'k' }), /requires Gemini 3\.5 or newer/)
  } finally {
    if (previous === undefined) delete process.env.GEMINI_MODEL
    else process.env.GEMINI_MODEL = previous
  }
})

test('Vertex mints a short-lived token per request and never stores credentials', async () => {
  let minted = 0
  const bearers: (string | null)[] = []
  const provider = new VertexGeminiProvider({
    project: 'p',
    tokenProvider: async () => { minted += 1; return `metadata-token-${minted}` },
    fetchImpl: async (input, init) => {
      bearers.push(new Request(input, init).headers.get('authorization'))
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{}' }] } }] }))
    },
  })
  await provider.generate({ agent: 'scout', instruction: 'x', context: 'y' })
  await provider.generate({ agent: 'scout', instruction: 'x', context: 'y' })
  // A fresh token each call is what makes metadata-server rotation work.
  assert.deepEqual(bearers, ['Bearer metadata-token-1', 'Bearer metadata-token-2'])
  assert.equal(minted, 2)
})

test('Vertex fails closed with a clear error when credentials cannot be obtained', async () => {
  let fetched = false
  const provider = new VertexGeminiProvider({
    project: 'p',
    tokenProvider: async () => { throw new Error('metadata server unreachable') },
    fetchImpl: async () => { fetched = true; return new Response('{}') },
  })
  await assert.rejects(() => provider.generate({ agent: 'scout', instruction: 'x', context: 'y' }), /metadata server unreachable/)
  // No unauthenticated request may leave the process.
  assert.equal(fetched, false)

  const run = await runOpportunity(snapshot, profile, undefined, { extract: createOpportunityExtractor(provider) })
  assert.equal(run.status, 'failed')
  assert.equal(run.evidence.length, 0)
  assert.ok(!run.events.some(event => event.type === 'ACTION_EXECUTED'))
})

test('GOOGLE_ACCESS_TOKEN stays a local override and ADC is the default provider', async () => {
  const previous = process.env.GOOGLE_ACCESS_TOKEN
  try {
    process.env.GOOGLE_ACCESS_TOKEN = 'local-dev-token'
    let bearer: string | null = null
    const provider = new VertexGeminiProvider({ project: 'p', fetchImpl: async (input, init) => {
      bearer = new Request(input, init).headers.get('authorization')
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{}' }] } }] }))
    } })
    await provider.generate({ agent: 'scout', instruction: 'x', context: 'y' })
    assert.equal(bearer, 'Bearer local-dev-token')
  } finally {
    if (previous === undefined) delete process.env.GOOGLE_ACCESS_TOKEN
    else process.env.GOOGLE_ACCESS_TOKEN = previous
  }
  // With no token configured the provider resolves credentials lazily through ADC.
  assert.equal(typeof applicationDefaultTokenProvider(), 'function')
})

test('Vertex still requires an explicit project before it attempts any credential work', async () => {
  const provider = new VertexGeminiProvider({ project: undefined, tokenProvider: async () => { throw new Error('should not resolve credentials') } })
  await assert.rejects(() => provider.generate({ agent: 'scout', instruction: 'x', context: 'y' }), /GOOGLE_CLOUD_PROJECT/)
})