# Publish Triage (prototype, all data synthetic)

Support intake workbench for **"Preview works, published app fails"** reports. Turns a ticket into a bounded reproduction, evidence-backed diagnosis, and human-reviewed escalation packet.

## What is built

- Intake: validate (Zod) → redact secrets → deterministic Preview-vs-published config diff → JSON persistence with append-only events. Works with no LLM.
- Extraction: structured facts with ticket-span refs, nulls for absent facts, missing-evidence detection, conflict detection. Never infers production state from Preview.
- Checks: fixed 5-check catalog, at most 3 per case, URL allowlist + timeouts + caps enforced in code. No arbitrary commands or URLs.
- Diagnosis: evidence-linked ranked hypotheses (fixed category enum), each with evidence IDs, disconfirming test, uncertainty. Abstains with an evidence request when evidence is insufficient; healthy apps yield no invented defect.
- Review: editable reply/escalation packet, approve/reject, local mock Zendesk/Linear action with idempotency key (replay-safe, 409 in-flight, 422 on payload reuse), Markdown/JSON export.
- Eval: 24 synthetic cases (6 dev + 18 held-out), deterministic-only baseline, editable ROI scenario.

## What is synthetic

Everything: fixtures, tickets, logs, configs, timings, ROI inputs. Nothing here touches Replit production, real customers, or internal systems. The demo proves the workflow and evidence chain, not any production incident rate.

## Run

- `npm install`, `npm test` (full suite incl. release gates), `npm run typecheck`
- `npm run eval` — runs the 24-case held-out suite, writes `eval/results.json`
- `npm run serve` — review UI at http://localhost:3000 (queue, case detail, approve/reject, `/roi`)
- `npm run case:run -- fixtures/missing-prod-config.json demo-1`, `npm run check:run -- fixtures/bad-start-port.json`

## Eval results (synthetic)

See `eval/results.json` (raw numerator/denominator). Release gates: all safety cases pass; ≥90% correct disposition on non-safety held-out. Baseline is a diff-only classifier; the full pipeline earns its place on redirect, intermittent, conflicted, and evidence-request cases.

## ROI inputs needing Replit confirmation

Formula: `eligible incidents/month × minutes saved ÷ 60 × loaded $/hour` (capacity value, not cash saved). The one input to confirm with an insider is **eligible incidents/month**; handling-time reduction and hourly cost are also assumptions. Adjust live on `/roi`. Paired baseline-vs-prototype human timings must be recorded on the same synthetic case during the demo — in-code pipeline milliseconds are not handling time.
