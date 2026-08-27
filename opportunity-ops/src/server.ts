import { createHash } from 'node:crypto'
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { runOpportunity } from './agent.js'
import { ingestSource } from './ingestion.js'
import { GoogleCloudRunPersistence, MemoryRunPersistence, type RunPersistence } from './persistence.js'
import type { Opportunity, SourceSnapshot, UserProfile } from './domain.js'
import { createSubmissionPackage, renderSubmissionMarkdown } from './submission.js'
import { createExtractorFromEnv } from './providers.js'
import { runRehearsal } from './rehearsal.js'

const profile: UserProfile = { name: 'Builder', interests: ['agentic'], technologies: ['Gemini', 'Google ADK', 'Google Cloud'], location: 'UK', availableHours: 20 }
const defaultText = ['title: All Things Agentic Hackathon', 'deadline: 2026-08-31T17:00:00+00:00', 'eligible: adults with internet access', 'required: Gemini, Google ADK, Google Cloud', 'deliverable: working autonomous agent', 'deliverable: architecture diagram', 'judging: innovation and operational utility'].join('\n')
const persistence: RunPersistence | undefined = process.env.PERSISTENCE === 'memory' ? new MemoryRunPersistence() : process.env.PERSISTENCE === 'cloud' ? new GoogleCloudRunPersistence() : undefined
// Built once per process; undefined unless EXTRACTOR=gemini or MODEL_MODE=vertex is set.
const modelExtractor = createExtractorFromEnv()
const localRuns = new Map<string, ReturnType<typeof createSubmissionPackage>>()

const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Opportunity Ops</title><style>
:root{color-scheme:dark;font:16px system-ui;background:#0b1020;color:#e8ecf8}body{max-width:1100px;margin:0 auto;padding:32px}h1{margin-bottom:4px}p{color:#aab4d0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}section{background:#131a2e;border:1px solid #293554;border-radius:14px;padding:20px}input,textarea{width:100%;box-sizing:border-box;background:#0b1020;color:#e8ecf8;border:1px solid #405077;border-radius:8px;padding:12px;font:14px monospace}textarea{height:180px}button{background:#5eead4;color:#07131c;border:0;border-radius:8px;padding:10px 14px;margin:10px 8px 0 0;font-weight:700;cursor:pointer}.conflict{background:#fb7185;color:#260810}.status{font-size:22px;font-weight:800}.verified{color:#5eead4}.failed{color:#fb7185}.blocked{border:2px solid #fb7185;background:#351524;padding:16px;margin-bottom:16px;border-radius:8px}.item{border-top:1px solid #293554;padding:10px 0}.scorecard{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:14px 0}.metric{background:#0b1020;border:1px solid #293554;border-radius:8px;padding:10px}.metric b{display:block;color:#5eead4;font-size:18px}.roles{color:#c7d2fe}@media(max-width:750px){.grid{grid-template-columns:1fr}.scorecard{grid-template-columns:1fr 1fr}}
<style></head><body><h1>Opportunity Ops</h1><p>Research, plan, act, and verify—before an unsafe claim becomes an action.</p><section><h2>Judge evidence</h2><button onclick="loadEvidence()">Run judge rehearsal</button><div id="evidence"><p>Loading deterministic safety scorecard…</p></div></section><section><h2>1. Source input</h2><label>Real source URL (optional)</label><input id="url" placeholder="https://example.com/opportunity"><p>Enter a reachable URL to fetch and sanitize it, or leave the URL empty to use the editable offline snapshot.</p><textarea id="source"></textarea><br><button onclick="run(false)">Run verified path</button><button class="conflict" onclick="run(true)">Seed deadline conflict</button></section><div id="result" class="grid" style="margin-top:20px"></div><script>
const source=document.querySelector('#source');source.value=${JSON.stringify(defaultText)};
async function loadEvidence(){const target=document.querySelector('#evidence');target.innerHTML='<p>Running rehearsal…</p>';try{const r=await fetch('/api/judge-evidence');const data=await r.json();if(!r.ok||data.error)throw new Error(data.error||('Request failed: '+r.status));const score=data.evaluation;const verified=data.verified;const blocked=data.blocked;target.innerHTML='<div class="scorecard"><div class="metric"><small>Adversarial cases</small><b>'+(score.passed+'/'+score.total)+'</b></div>'+score.signals.map(s=>'<div class="metric"><small>'+s.name+'</small><b>'+s.value+'</b></div>').join('')+'</div><p><b>Verified path:</b> '+verified.run.status+' — '+verified.run.events.join(' → ')+'</p><p><b>Trust path:</b> '+blocked.run.status+' — '+blocked.run.events.join(' → ')+'</p><p class="'+(score.score===100?'verified':'failed')+'"><b>'+score.score+'% expected safety behavior reproduced.</b></p>'}catch(error){target.innerHTML='<p class="failed"><b>Evidence unavailable:</b> '+error.message+'</p>'}}
loadEvidence();
async function run(conflict){const result=document.querySelector('#result');result.innerHTML='<section><p>Running…</p></section>';try{const r=await fetch('/api/run',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:document.querySelector('#url').value,text:source.value,scenario:conflict?'deadline-conflict':'normal'})});const data=await r.json();if(!r.ok||data.error)throw new Error(data.error||('Request failed: '+r.status));const ok=data.status==='verified';const evidence=data.evidence.length?data.evidence.map(e=>'<div class="item"><b>'+(e.verified?'✅':'❌')+' '+e.claim+'</b><br><small>'+(e.reason??'')+'</small>'+(e.sourceValue?'<br>Source: '+e.sourceValue:'')+'</div>').join(''):'<p>No evidence produced.</p>';const banner=ok?'':'<div class="blocked"><b>BLOCKED: Agent claim conflicts with authoritative source</b><br>No operator action was executed.</div>';const packageLink=ok?'<p><a href="'+data.packageUrl+'" download>Download verified submission package</a></p>':'';const blueprint=data.packageData?.blueprint;const scorecard=ok&&blueprint?'<h3>Independent-agent scorecard</h3><div class="scorecard">'+blueprint.evaluationSignals.map(s=>'<div class="metric"><small>'+s.name+'</small><b>'+s.value+'</b></div>').join('')+'</div><p class="roles"><b>Execution:</b> '+blueprint.roles.map(role=>role.name).join(' → ')+'</p>':'';const provenance='<p><b>Source:</b> '+data.sourceMode+'<br><b>URL:</b> '+data.sourceUrl+'<br><b>Version:</b> '+data.sourceVersion+'<br><b>Extractor:</b> '+data.extractorMode+'</p>';const failure=data.failureReason?'<p><b>Reason:</b> '+data.failureReason+'</p>':'';result.innerHTML='<section>'+banner+'<h2>2. Decision</h2><div class="status '+(ok?'verified':'failed')+'">'+(ok?'VERIFIED':'BLOCKED')+'</div>'+provenance+failure+'<p>Fit score: '+(data.fitScore??'—')+'</p>'+packageLink+scorecard+'<h3>Evidence</h3>'+evidence+'</section><section><h2>3. Audit timeline</h2><pre>'+data.timeline.join('\\n')+'</pre><p>'+(!ok?'No operator action was executed.':'Artifact and verification completed.')+'</p></section>'}catch(error){result.innerHTML='<section><h2>Run could not start</h2><div class="status failed">INPUT ERROR</div><p>'+error.message+'</p><p>Use a reachable HTTPS URL, or include <code>title:</code> and <code>deadline:</code> lines in the snapshot.</p></section>'}}
</script></body></html>`

async function body(request: IncomingMessage): Promise<string> {
  let value = ''; for await (const chunk of request) value += chunk
  return value
}
function json(response: ServerResponse, status: number, value: unknown): void { response.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); response.end(JSON.stringify(value)) }

export function createServer() {
  return createHttpServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/healthz') { json(response, 200, { status: 'ok', service: 'opportunity-ops' }); return }
    if (request.method === 'GET' && request.url === '/api/judge-evidence') {
      try {
        const report = await runRehearsal()
        const summarize = (path: typeof report.verified) => ({
          name: path.name,
          purpose: path.purpose,
          elapsedMs: path.elapsedMs,
          highlights: path.highlights,
          run: {
            status: path.run.status,
            events: path.run.events.map(event => event.type),
            evidence: path.run.evidence,
          },
        })
        json(response, 200, { generatedAt: report.generatedAt, verified: summarize(report.verified), blocked: summarize(report.blocked), evaluation: report.evaluation })
      } catch (error) { json(response, 500, { error: error instanceof Error ? error.message : String(error) }) }
      return
    }
    if (request.method === 'GET' && request.url === '/') { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(page.replace('<style></head>', '</style></head>')); return }
    if (request.method === 'POST' && request.url === '/api/run') {
      try {
        const input = JSON.parse(await body(request)) as { url?: string; text?: string; scenario?: string }
        if (!input.url && !input.text?.trim()) { json(response, 400, { error: 'url or text is required' }); return }
        const snapshot: SourceSnapshot = input.url ? await ingestSource(input.url) : { url: 'http://local/opportunity', version: createHash('sha256').update(input.text!).digest('hex').slice(0, 16), text: input.text!, fetchedAt: new Date().toISOString() }
        const seedConflict = () => {
          const sourceDeadline = snapshot.text.match(/deadline:\s*(\S+)/i)?.[1]
          const wrong = new Date(new Date(sourceDeadline ?? '').getTime() + 15 * 86_400_000).toISOString()
          return { id: 'seeded-conflict', title: 'Seeded conflict', sourceUrl: snapshot.url, deadlineIso: wrong, timezone: 'UTC', eligibility: [], requiredTechnologies: ['Gemini'], deliverables: ['demo'], judgingCriteria: [], citations: { deadline: snapshot.url, requirements: snapshot.url }, sourceVersion: snapshot.version } satisfies Opportunity
        }
        const extract = input.scenario === 'deadline-conflict' ? seedConflict : modelExtractor
        const extractorMode = extract === seedConflict ? 'seeded conflict' : modelExtractor ? `model (${process.env.GEMINI_MODEL ?? 'default'})` : 'deterministic'
        const run = await runOpportunity(snapshot, profile, undefined, { extract, persistence })
        const failedEvent = [...run.events].reverse().find(event => event.type === 'RUN_FAILED')
        const failureReason = failedEvent?.data?.error
        const packageData = run.status === 'verified' ? createSubmissionPackage(run) : undefined
        if (packageData) localRuns.set(run.id, packageData)
        json(response, 200, { runId: run.id, status: run.status, fitScore: run.plan?.fitScore, evidence: run.evidence, timeline: run.events.map(event => event.type), failureReason, sourceMode: input.url ? 'live URL' : 'offline snapshot', sourceUrl: snapshot.url, sourceVersion: snapshot.version, extractorMode, packageData, packageUrl: packageData ? `/api/runs/${run.id}/submission-package.md` : undefined })
      } catch (error) { json(response, 422, { error: error instanceof Error ? error.message : String(error) }) }
      return
    }
    const download = request.method === 'GET' ? request.url?.match(/^\/api\/runs\/([^/]+)\/submission-package\.md$/) : undefined
    if (download) {
      const packageData = localRuns.get(download[1])
      if (!packageData) { json(response, 404, { error: 'submission package not found' }); return }
      response.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': `attachment; filename="submission-package.md"` })
      response.end(renderSubmissionMarkdown(packageData)); return
    }
    response.writeHead(404); response.end('Not found')
  })
}

if (process.argv[1]?.endsWith('server.ts')) createServer().listen(Number(process.env.PORT ?? 3000), () => console.log(`Opportunity Ops UI: http://localhost:${process.env.PORT ?? 3000}`))