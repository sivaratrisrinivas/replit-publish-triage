# 02: Deterministic intake to save

**What to build:** Synthetic ticket intake through validation, redaction, deterministic comparison, and JSON/SQLite persistence completing without any LLM.

**Blocked by:** 01: Fixtures plus schemas plus redaction plus diff

**Status:** ready-for-agent

- [ ] `runCase` pipeline seam validates, redacts, diffs, saves caseRecord with append-only events
- [ ] Incomplete ticket saves with missing-evidence list, no invented fields
- [ ] Gold answers never in runtime input
- [ ] One command runs intake->save on a seeded case
