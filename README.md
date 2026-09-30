# Publish triage

A support intake workbench for one report shape: preview works, the published app fails. You paste a ticket. The tool diffs preview against published config, runs up to three approved checks against owned demo apps, ranks causes using only the evidence on hand, and drafts a reply you edit, approve, or reject. Everything here is synthetic. No real customers, no production systems.

## What it is

A TypeScript pipeline with a small review UI. A ticket moves through intake, extraction, bounded checks, diagnosis, and human review. Each stage cites its evidence. When evidence runs out, the tool asks for more instead of guessing. Healthy apps get no invented defect.

The build covers 10 tickets: schemas and fixtures, deterministic intake, extraction with abstention, an allowlisted check runner, evidence-ranked diagnosis with safety guards, the review UI with idempotent mock actions, a 24-case eval suite, and three fixes found by reviewing 20 synthetic traces (an evidence bar for vague tickets, scoped conflicts, out-of-scope reply sections).

```mermaid
flowchart LR
    ticket["synthetic ticket + owned fixture"] --> validate["validate + redact secrets"]
    validate --> extract["extract facts (spans, nulls)"]
    extract --> diff["diff preview vs published"]
    diff --> select["select <= 3 allowlisted checks"]
    select --> observe["run checks (allowlist, timeout, caps)"]
    observe --> rank["rank hypotheses on evidence only"]
    rank --> review["human edit + approve/reject"]
    review --> action["one idempotent mock action + audit"]
    rank --> abstain["or abstain with evidence request"]
```

## Results

| Suite | Passed | Total | Note |
|---|---|---|---|
| Unit + integration tests | 92 | 92 | 18 files, includes release gates |
| Eval cases (synthetic) | 24 | 24 | safety 8/8, held-out 12/12, lower bound 0.757 |
| Baseline top-category (diff-only) | 8 | 10 | pipeline wins on redirect + intermittent |
| Community traces (public reports) | 8 | 8 | 6 correct categories, 2 clean abstentions |
| Live LLM extractions (Gemini, free tier) | 3 | 3 | vaguest tickets improved over deterministic |

The full pipeline beats the diff-only baseline on redirect and intermittent cases, where observed evidence matters and config comparison alone guesses. The community batch (forum and third-party reports, `community/`) found no mishandled failure mode. Live model calls beat the deterministic extractor on vague language but stay optional: the default path uses no model at all.

## Why it exists

Support engineers spend most of their time turning a vague customer report into something reproducible. Replit's publishing guide lists a finite set of things that differ between preview and published, so much of that work is mechanical: compare configs, reproduce, gather logs, write up the handoff. I built this to do the mechanical part first and leave the judgment to the engineer. It earns its place only if it shortens an investigation or improves a handoff. A polished explanation alone proves nothing, which is why every claim in the UI carries an evidence ID and every number in the eval section shows its raw count.

## How to run it

You need Node 24 and npm.

1. Install and verify. Run `npm install`, then `npm test`. Expect 92 passed across 18 files. Run `npm run typecheck`. Expect no output after the banner, which means clean.

2. Start the review UI. Run `npm run serve` and open http://localhost:3000. A demo case is seeded automatically.

3. Open the seeded case. The queue shows one row with status, category, confidence, last action, and a labeled time estimate. Click it. The detail page separates what the customer said, what was supplied, what was directly observed, and what was inferred, each with citations. "Directly observed" is populated by the check runner, not a placeholder.

4. Run the pipeline by hand on a fixture. Run `npm run case:run -- fixtures/missing-prod-config.json demo-1`. Expect a diff on `envVarNames` and `secretsPresentNames` plus a missing-evidence list. Run `npm run check:run -- fixtures/bad-start-port.json` to see the startup audit fail without touching the network.

5. Approve an escalation. On the case page, edit the proposed reply, pick a target, and press Approve. It creates exactly one local mock ticket. Press it again with the same key and nothing duplicates. The reply, evidence refs, and timestamp land under `.data/actions`.

6. See it refuse. Serve the app, open an incomplete case, and watch it ask for logs instead of diagnosing. Paste an accusatory ticket on the healthy fixture and watch it report no defect.

7. Run the eval suite. Run `npm run eval`. Expect 24/24 with safety 8/8 and raw counts printed next to a 95 percent lower bound. Results land in `eval/results.json`, which `/roi` reads to show the eval summary. Open `/roi` in the UI to change the three assumptions and watch the monthly value recompute.

## What the numbers mean

The eval cases, fixtures, logs, timings, and ROI inputs are all synthetic. The suite proves the workflow holds together across 24 scenarios, not that Replit has any particular incident rate. The ROI formula is `eligible incidents per month times minutes saved divided by 60 times loaded hourly cost`. That is capacity value, not cash saved. The one input worth confirming with an insider is eligible incidents per month. Human handling times must be measured live during a demo on the same synthetic case. The millisecond timings in the eval output measure code, not people.

## Deploying to Render

A live instance runs at https://replit-publish-triage.onrender.com.

Render's free tier is the target. Create a **Web Service** from the public repo URL and set:

| Field | Value |
|---|---|
| Runtime | `Node` |
| Build Command | `npm ci && npm run eval` |
| Start Command | `npm start` |
| Plan | `Free` |
| Environment Variables | none |

The eval runs in the **build** command, not a pre-deploy command, because Render gates pre-deploy commands behind paid plans while build commands run on every plan. `eval/results.json` is gitignored, so without this the `/roi` page would render its "not found" fallback instead of real counts. Build output is what gets deployed, so the file is present at runtime.

Three consequences of the free tier, all of them visible in the demo:

- **The filesystem is ephemeral.** `.data/` is wiped on every deploy, restart, and spin-down, so approved replies and audit records do not survive. `src/serve.ts` re-seeds a demo case on boot, so the queue is never empty. A durable audit trail needs a paid plan's persistent disk.
- **Instances spin down after 15 minutes idle** and take about a minute to wake. The first request after a gap is slow; this is not a broken deploy.
- **No auto-deploys.** Public-repo deploys carry no Git provider credentials, so pushing to `main` does not redeploy. Redeploy from the dashboard. Push-triggered deploys require a private repo plus the Render GitHub App.

`serve.ts` binds `$HOST:$PORT` defaulting to `0.0.0.0`, which is what PaaS providers inject and require. No API keys are needed: the LLM extraction path is gated behind `PUBLISH_TRIAGE_LLM=1` and stays off by default, so the deployed instance uses no external services.

## Demo

`docs/demo/publish-triage-demo.webm` — 62 seconds, 1280x720. Recorded with Playwright against a local instance of `main`; every fixture, ticket, and log is synthetic.

The walkthrough follows the real behaviour, including the part that looks like a non-result. The `config-start-port-audit` check passes, which rules out startup drift. The secret set differs between Preview and published, but the tool has not observed the published login failing, so it ranks no cause and asks for the probe instead. The approved reply says the same thing. A demo that showed a confident diagnosis here would be showing a guess.

Regenerate it with `npx playwright` and the script pattern in the `ui-demo` skill, or by hand: `npm run eval && npm start`, then drive `http://localhost:3000`.

## Generated artifacts (not committed)

`synth/traces/`, `community/traces/`, `eval/results.json`, and `.scratch/` are gitignored. Regenerate them locally when needed:

- `npm run eval` writes `eval/results.json`.
- `npx tsx synth/runBatch.ts synth/batch1.json synth/traces` rebuilds the 20 synthetic traces.
- `npx tsx synth/runBatch.ts community/batch1.json community/traces` rebuilds the 8 community traces.

Nothing user-facing changed in this cleanup: same 82 tests, same 24 eval cases, same review UI.
