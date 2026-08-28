# Opportunity Ops

Opportunity Ops is an original Taskmaster-track vertical slice. It turns a messy opportunity source into structured facts, a fit-scored execution plan, a generated artifact, and an independent evidence report.

## Current vertical slice

`npm run demo` runs locally without credentials:

```text
source snapshot -> Scout/Extractor -> Planner -> Operator -> Verifier
```

The demo uses a deterministic fixture by default. To exercise bounded live ingestion, set `SOURCE_URL` to a reachable HTTPS URL or a local text/HTML file path before running `npm run demo`. Do not copy a placeholder such as `https://your-source.example/page`; `.example` is reserved for documentation and will not resolve. The loader strips scripts/styles, limits content to 1 MB, hashes normalized content into `sourceVersion`, and fails closed on fetch errors. PDF extraction and authenticated sources are intentionally deferred to a provider-specific adapter rather than guessed.

The evaluation suite also exercises malformed and expired input, embedded prompt-injection text, approval denial for external actions, and source-version changes. Run it with `npm test`.

The event timeline is replayable and the verifier is deliberately separate from extraction. Missing deadlines fail closed. The external-action tool requires approval by policy, while run-local artifact creation is allowed.

The trust-demo deliberately seeds a wrong extracted deadline and proves that the verifier compares it with the source snapshot before the operator runs:

```powershell
$env:DEMO_SCENARIO = 'deadline-conflict'
npm run demo
Remove-Item Env:DEMO_SCENARIO
```

Expected result: `status: "failed"`, a `VERIFICATION_FAILED` conflict, and `ACTION_BLOCKED` with no `ACTION_EXECUTED` event. The source snapshot remains authoritative; model output is only a claim to verify.

## Run

```powershell
npm install
npm run typecheck
npm test
npm run demo
npm run evaluate
npm run rehearse
```

`npm run evaluate` runs the deterministic adversarial rehearsal: prompt-injection resilience, malformed input fail-closed behavior, verifier blocking of a conflicting deadline, external approval denial, and source refresh detection. It prints JSON for inspection plus a Markdown scorecard for the judge narrative, and exits non-zero if any expected safety behavior regresses.

To save the judge artifact, set `EVALUATION_OUTPUT`:

```powershell
$env:EVALUATION_OUTPUT = 'evaluation-scorecard.md'
npm run evaluate
Remove-Item Env:EVALUATION_OUTPUT
```

`npm run rehearse` runs both judge paths and writes `judge-rehearsal.md` (or the path in `REHEARSAL_OUTPUT`). Use it as the timed pitch script: lead with the verified path, then run the seeded conflict to demonstrate that the verifier blocks action. The command exits non-zero if either expected outcome regresses.

```powershell
$env:REHEARSAL_OUTPUT = 'judge-rehearsal.md'
npm run rehearse
Remove-Item Env:REHEARSAL_OUTPUT
```

## Cloud Run rehearsal

The repository includes a production-shaped container contract. The image listens on Cloud Run's `PORT` (defaulting to `3000` when `PORT` is unset), exposes `8080`, and provides `GET /healthz` for startup probing. Validate the contract without cloud credentials:

```powershell
docker build -t opportunity-ops:local .
docker run --rm -p 8080:8080 -e PORT=8080 opportunity-ops:local
```

In another terminal, request `http://localhost:8080/healthz`, then open `http://localhost:8080`. The manifest uses placeholders intentionally. Replace `PROJECT`, `REGION`, the image reference, and the `serviceAccountName` placeholder before deploying; the manifest already authenticates through workload identity rather than a long-lived access token. `PERSISTENCE=memory` (the `.env.example` value) is suitable for the demo; production should set `PERSISTENCE=cloud` and `OPPORTUNITY_OPS_BUCKET`.

## Judge UI

Run `npm run serve` and open the URL it prints on startup: `http://localhost:3002` with the committed `.env.example`, which sets `PORT=3002`, or `http://localhost:3000` when `PORT` is unset. Enter a reachable opportunity URL and use **Run verified path**. The page fetches and sanitizes the URL through the bounded ingestion layer, then shows live-source provenance, cited evidence, conflict details, replayable audit timeline, and a downloadable verified submission package. Leave the URL empty to use the editable offline snapshot. The package includes an executive summary, a “Why this can win” argument, the agent architecture, demo script, judging-criteria map, milestone plan, and citations. Blocked runs never receive a package link. For the strongest rehearsal, demonstrate both the verified path and the **Seed deadline conflict** path: the latter proves that the verifier blocks execution before an unsafe action. This is intentionally local and credential-free; it is the presentation layer to put in front of judges before adding cloud persistence.

If you see `EADDRINUSE`, an older server is still holding that port. Stop that terminal/process, then start the server again and hard-refresh the browser (`Ctrl+F5`). To sidestep an occupied port, pick another one — ` $env:PORT=3005; npm run serve ` — and open the URL the server prints. The UI reports parser/API errors in the result panel rather than silently ignoring a click. The current local fixture format expects `title:` and `deadline:` lines; use the CLI `SOURCE_URL` path for live web ingestion until the browser ingestion adapter is added.

For the opt-in Vertex path, credentials come from Application Default Credentials — `gcloud auth application-default login` locally, or the attached service account on Cloud Run. `GOOGLE_ACCESS_TOKEN` stays available as an optional local override when you already hold a short-lived token:

```powershell
$env:GOOGLE_CLOUD_PROJECT = 'your-project-id'
$env:MODEL_MODE = 'vertex'
$env:SOURCE_URL = 'https://a-real-reachable-opportunity-url'
npm run demo
Remove-Item Env:GOOGLE_CLOUD_PROJECT, Env:MODEL_MODE, Env:SOURCE_URL
```

The Vertex path is deliberately opt-in and schema-validates Gemini output before the local planner uses it. It requires a billed Google Cloud project, so the local demo and the recorded walkthrough use the Gemini Developer API key path below instead. A Google ADK runner remains an interface rather than an implementation.

## Gemini extraction

Extraction has two interchangeable implementations behind the same `extract` hook on `runOpportunity`:

| Selector | Extractor | Credentials |
| --- | --- | --- |
| `EXTRACTOR` unset (default) | deterministic regex over the sanitized snapshot | none |
| `EXTRACTOR=gemini` | `GeminiApiProvider` — Gemini Developer API | `GEMINI_API_KEY` |
| `MODEL_MODE=vertex` | `VertexGeminiProvider` — Vertex AI REST | `GOOGLE_CLOUD_PROJECT` + Application Default Credentials |

`MODEL_MODE=vertex` routes extraction through a model on its own; it does not also need `EXTRACTOR=gemini`. `GEMINI_MODEL` selects the model in both cases and must name Gemini 3.5 or newer — each provider rejects an older generation when it is constructed, so a stale value cannot silently downgrade a run. The default is `gemini-3.5-flash`.

`npm run demo` and `npm run serve` read `.env` (see `.env.example`) and honor `EXTRACTOR`. `npm run evaluate` and `npm run rehearse` stay deterministic on purpose so the judge scorecard remains reproducible.

```powershell
$env:EXTRACTOR = 'gemini'
$env:GEMINI_API_KEY = 'your-ai-studio-key'
$env:SOURCE_URL = 'https://a-real-reachable-opportunity-url'
npm run demo
Remove-Item Env:EXTRACTOR, Env:GEMINI_API_KEY, Env:SOURCE_URL
```

Two properties hold regardless of which extractor runs:

- **The model never asserts provenance.** It returns facts only — title, deadline, timezone, eligibility, technologies, deliverables, judging criteria. `composeOpportunity` stamps `id`, `sourceUrl`, `citations`, and `sourceVersion` from the snapshot, so a source that tries to redirect its own citations cannot. Keys outside the facts contract are stripped before validation.
- **The verifier, not the extractor, authorizes action.** `verify` in `src/agent.ts` re-derives the deadline from the untouched snapshot and compares it to the claim. A hallucinated or unconfirmable deadline yields `ACTION_BLOCKED` before any artifact is written.

The practical consequence: a model-extracted deadline only reaches an action when `sourceDeadline` can independently confirm it from the snapshot — today that means a JSON-LD `endDate` or an explicit `deadline:` line. A prose-only page such as "applications close November 30, 2026 at 5pm Pacific" blocks with `Source says no deadline` even when the model reads it correctly. That is fail-closed by design. To widen coverage, add independent (non-model) date patterns to `sourceDeadline` in `src/agent.ts` — never by having the verifier trust the extractor.

## Planned Google Cloud implementation

- Gemini 3.5+ through Vertex AI, called by Google ADK agents.
- Cloud Run API and worker.
- Firestore for runs, plans, approvals, and evidence.
- Pub/Sub for asynchronous execution and retry/dead-letter handling.
- Cloud Storage for source snapshots and generated assets.
- Cloud Scheduler for opportunity refresh.
- Cloud Logging/Trace and OpenTelemetry-compatible events for the audit timeline.

`src/providers.ts` now contains a real Vertex AI REST adapter and a Gemini Developer API adapter, plus interfaces for a Google ADK runner, Firestore-backed `RunStore`, and Pub/Sub-backed `WorkQueue`. Set `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, and `GEMINI_MODEL` to exercise the Vertex adapter; credentials resolve through Application Default Credentials, with `GOOGLE_ACCESS_TOKEN` as an optional local override. The local demo calls no model unless `EXTRACTOR=gemini` or `MODEL_MODE=vertex` is set.

`cloud-run.yaml` deploys the Vertex path under workload identity and carries no API key, secret reference, or access token. To use it: replace `PROJECT` and `REGION`, replace the `serviceAccountName` placeholder with a real service account, grant that account `roles/aiplatform.user`, and build an image. Deploying it needs a billed project, which is why the current demo path is the Gemini Developer API key instead.

## Persistence

Runs can persist their immutable source snapshot and generated artifacts in Cloud Storage, while the complete run aggregate (status, plan, evidence, approvals, and replayable events) is stored in Firestore. The adapters use Google Cloud client libraries and Application Default Credentials, so Cloud Run should use its service account/workload identity rather than a long-lived key.

With `PERSISTENCE` unset, `src/server.ts` selects no persistence backend at all: a run lives only in the responding process, and no credentials are involved. `.env.example` sets `PERSISTENCE=memory`, which exercises the full persistence lifecycle in process — use `PERSISTENCE=memory npm run serve` for a local smoke test without contacting Google Cloud. For production, configure:

```powershell
$env:PERSISTENCE = 'cloud'
$env:GOOGLE_CLOUD_PROJECT = 'your-project-id'
$env:OPPORTUNITY_OPS_BUCKET = 'your-source-and-artifact-bucket'
npm run serve
```

The local core intentionally uses interfaces and deterministic fixtures first. Google credentials and external side effects must not be required to run the acceptance tests.

Cloud object paths are immutable: `snapshots/<sourceVersion>.txt` and `artifacts/<runId>/<artifactName>`. Firestore documents use `opportunityRuns/<runId>`. Storage writes use an `ifGenerationMatch: 0` precondition, so retries do not overwrite an existing snapshot or artifact. The local persistence tests cover successful runs, blocked runs, artifact retention, and stable content hashes.

## Safety model

Every tool declares read-only, destructive, and external-side-effect properties. External actions require an approval callback. Source documents are untrusted data; extracted claims must carry citations and are rechecked by the verifier. All writes will use `runId`-scoped idempotency keys in the Cloud implementation.
