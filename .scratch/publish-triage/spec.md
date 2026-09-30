## Problem Statement

Support engineers handling "Preview works, published app fails" reports must manually turn incomplete customer language into a reproducible case, compare Preview vs published configuration, run bounded reproduction, and build an evidence-linked escalation. This is slow and error-prone when tickets omit environment, deployment type, logs, or production-only values.

## Solution

Publish Triage: a local-first solo prototype workbench that ingests a synthetic ticket + owned fixture snapshots, validates/redacts, deterministically diffs Preview vs published config, runs at most 3 allowlisted checks against owned demo apps, ranks hypotheses using only supplied/observed evidence, abstains when evidence is insufficient, and produces a human-reviewed reply/escalation packet with a local mock Zendesk/Linear action and audit trail.

Choices locked this session: full 5-day scope, SQLite/JSON persistence (not Postgres for day 1-2), local Playwright/HTTP checks, local-first run (bring LLM keys, deterministic path works without LLM).

## User Stories

1. As a support engineer, I want to load a seeded publishing incident, so that I can start triage without pasting a ticket.
2. As a support engineer, I want to paste a synthetic ticket, so that I can triage a new report.
3. As a support engineer, I want extracted symptom/expected/actual/environment/timestamp/deployment-type/missing-evidence, so that I see what was claimed vs what is unknown.
4. As a support engineer, I want Preview vs published config diff, so that I see exact environment differences.
5. As a support engineer, I want at most 3 checks selected from an explicit allowlist, so that reproduction stays bounded and safe.
6. As a support engineer, I want to approve a check before it runs, so that no observation happens without consent.
7. As a support engineer, I want captured observations (HTTP/browser) with what actually happened, so that diagnosis cites observed facts.
8. As a support engineer, I want ranked causes using only supplied evidence with unknowns/conflicts marked, so that I do not get confident guesses.
9. As a support engineer, I want an explicit evidence request when data is insufficient, so that I can ask the customer for the right artifact.
10. As a support engineer, I want to edit/approve/reject a proposed reply/escalation, so that nothing sends without human review.
11. As a support engineer, I want one auditable local mock Zendesk/Linear action with evidence refs + timestamp + idempotency key, so that repeats do not duplicate.
12. As a support engineer, I want a case queue with status/category/confidence/last-action/est-time-saved, so that I can prioritize.
13. As a support engineer, I want case detail showing reported/supplied/observed/inferred facts separately with citation/evidence ID, so that I trust the chain.
14. As a support engineer, I want Markdown + JSON export, so that I can hand off outside the tool.
15. As an evaluator, I want a 24-case set (6 dev + 18 held-out) with expected category/evidence/allowed-checks/outcome/disposition, so that I can measure without tuning on the test set.
16. As an evaluator, I want safety gates (injection, allowlist, secrets, duplicates, stale docs), so that unsafe behavior fails loudly.
17. As an evaluator, I want deterministic-only baseline comparison, so that the LLM earns its place on ambiguous intake/handoff quality.
18. As a demo viewer, I want editable ROI assumptions (eligible incidents, minutes saved, loaded cost) with scenario math labeled, so that I see capacity value not false savings.
19. As a demo viewer, I want paired timing (baseline vs prototype on same synthetic case) shown separately, so that I do not mistake prototype timing for production forecast.

## Implementation Decisions

- Modules: intake-validate-redact, config-compare (deterministic), check-catalog + local runner, hypothesis-rank, review-action (mock adapters), queue/detail UI, eval harness, fixtures.
- Seams (highest possible, prefer one): single case-pipeline seam `runCase(ticket, snapshots) -> caseRecord` covering validate->extract->diff->select->observe->rank->review->action. New seams only where runtime demands: check-runner boundary (allowlist/timeout) and action boundary (idempotency/audit). No wide refactor; greenfield.
- Contracts first, Zod-validated at boundaries: Ticket, ConfigSnapshot, Evidence, Observation, Hypothesis (with evidenceIds), Review, Action (with idempotencyKey, promptVersion, sourceDocVersion, timestamps). Append-only events where possible. Gold answers never in runtime input.
- Persistence day 1-2: SQLite/JSON files (migrate to Postgres only if day-6 hosted demo demands). No customer code execution; owned seeded apps only; URL allowlist + timeouts + run caps enforced in code, not prompts.
- LLM behind env flag: extractor / check-selector (max 3, named catalog only) / diagnosis-writer (reported/observed/inferred split + disconfirming test) / escalation-writer (repro steps, expected/actual, env, open questions, suggested owner, no root-cause claim unless tested). Deterministic path must complete without LLM.
- UI states: customer-reported vs supplied-evidence vs directly-observed vs inferred, each with citation/evidence ID. Confidence never substitutes for evidence.
- Mock Zendesk/Linear: local adapters only, atomic claim on idempotencyKey via unique constraint, payload-hash guard (same key + different body = 422), in-flight duplicate = 409, retention outlives retry path.
- Synthetic-only: label all fake configs/logs, redact secret-like values before model calls/logs/exports, never retain secret values.

## Testing Decisions

- TDD red-green-refactor for every behavior; prove-it pattern for bug fixes. Test external behavior, not internals.
- Pyramid: ~80% unit (redaction, diff, rank, idempotency), ~15% integration (pipeline + runner + adapters with local fixtures), ~5% E2E (queue->detail->approve->mock-action on owned apps).
- Prior art: none in repo (greenfield). Follow repo's own commands once initialized (do not assume `npm test`); add focused-test + full-suite commands to README.
- Acceptance: handoff 18-case suite; safety cases must all pass; factual diagnoses must cite valid evidence; >=90% correct disposition on non-safety held-out with raw numerator/denominator; record failures/abstentions.

## Out of Scope

- Rebuilding Replit App Testing, ViBench, Telescope trace clustering, access requests, generic doc bot.
- Real customer accounts, production deploys, internal Replit data access, refund execution, automatic security/commercial sign-off.
- Postgres ops, hosted browser worker, and polished marketing site before deterministic loop + review + incomplete-evidence case work.
- Claiming measured Replit incident rates, handling-time savings, or cash savings; ROI stays scenario with labeled assumptions.

## Further Notes

- Source: `/tmp/replit-publish-triage-handoff.md` (lines 1-201) + `/home/srinivas/replit-hiring-evidence.md`. Hiring pages = responsibilities, not open reqs. No frequency/MTTR/tooling baselines.
- Three-day fallback preserved: one issue class, one fixture, deterministic comparison, one reviewed escalation, one incomplete-evidence case. Do not broaden before that loop works.
- Demo must state fixtures/tickets are synthetic; proves workflow + evidence chain, not production rate.
