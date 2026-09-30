# Publish triage

A support intake workbench for one report shape: preview works, the published app fails. You paste a ticket. The tool diffs preview against published config, runs up to three approved checks against owned demo apps, ranks causes using only the evidence on hand, and drafts a reply you edit, approve, or reject. Everything here is synthetic. No real customers, no production systems.

## What it is

A TypeScript pipeline with a small review UI. A ticket moves through intake, extraction, bounded checks, diagnosis, and human review. Each stage cites its evidence. When evidence runs out, the tool asks for more instead of guessing. Healthy apps get no invented defect.

The build covers 10 tickets: schemas and fixtures, deterministic intake, extraction with abstention, an allowlisted check runner, evidence-ranked diagnosis with safety guards, the review UI with idempotent mock actions, a 24-case eval suite, and three fixes found by reviewing 20 synthetic traces (an evidence bar for vague tickets, scoped conflicts, out-of-scope reply sections).

## Why it exists

Support engineers spend most of their time turning a vague customer report into something reproducible. Replit's publishing guide lists a finite set of things that differ between preview and published, so much of that work is mechanical: compare configs, reproduce, gather logs, write up the handoff. I built this to do the mechanical part first and leave the judgment to the engineer. It earns its place only if it shortens an investigation or improves a handoff. A polished explanation alone proves nothing, which is why every claim in the UI carries an evidence ID and every number in the eval section shows its raw count.

## How to run it

You need Node 24 and npm.

1. Install and verify. Run `npm install`, then `npm test`. Expect 75 passed across 16 files. Run `npm run typecheck`. Expect no output after the banner, which means clean.

2. Start the review UI. Run `npm run serve` and open http://localhost:3000. A demo case is seeded automatically.

3. Open the seeded case. The queue shows one row with status, category, confidence, last action, and a labeled time estimate. Click it. The detail page separates what the customer said, what was supplied, what was directly observed, and what was inferred, each with citations.

4. Run the pipeline by hand on a fixture. Run `npm run case:run -- fixtures/missing-prod-config.json demo-1`. Expect a diff on `envVarNames` and `secretsPresentNames` plus a missing-evidence list. Run `npm run check:run -- fixtures/bad-start-port.json` to see the startup audit fail without touching the network.

5. Approve an escalation. On the case page, edit the proposed reply, pick a target, and press Approve. It creates exactly one local mock ticket. Press it again with the same key and nothing duplicates. The reply, evidence refs, and timestamp land under `.data/actions`.

6. See it refuse. Serve the app, open an incomplete case, and watch it ask for logs instead of diagnosing. Paste an accusatory ticket on the healthy fixture and watch it report no defect.

7. Run the eval suite. Run `npm run eval`. Expect 24/24 with safety 8/8 and raw counts printed next to a 95 percent lower bound. Results land in `eval/results.json`. Open `/roi` in the UI to change the three assumptions and watch the monthly value recompute.

## What the numbers mean

The eval cases, fixtures, logs, timings, and ROI inputs are all synthetic. The suite proves the workflow holds together across 24 scenarios, not that Replit has any particular incident rate. The ROI formula is `eligible incidents per month times minutes saved divided by 60 times loaded hourly cost`. That is capacity value, not cash saved. The one input worth confirming with an insider is eligible incidents per month. Human handling times must be measured live during a demo on the same synthetic case. The millisecond timings in the eval output measure code, not people.
