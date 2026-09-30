# 06: Queue detail review mock action

**What to build:** Case queue, case detail with four fact states, editable reply/escalation with approve/reject, one auditable local mock Zendesk/Linear action, Markdown/JSON export.

**Blocked by:** 05: Rank plus safety guards

**Status:** done (46/46 green, typecheck clean, live-served + committed 2026-09-30)

- [x] Queue shows status/category/confidence/last-action/est-time-saved (labeled assumption)
- [x] Detail separates customer-reported/supplied/observed/inferred with citations
- [x] Approval creates exactly one local action with evidence refs + timestamp; payload-hash guard; in-flight duplicate 409; repeat approval no duplicate
- [x] Export contains no secret values
