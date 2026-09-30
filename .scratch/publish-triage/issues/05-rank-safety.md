# 05: Rank plus safety guards

**What to build:** Evidence-linked hypothesis ranking separating reported/supplied/observed/inferred facts, with injection, allowlist, and secret safety gates.

**Blocked by:** 03: Extraction plus abstention, 04: Allowlisted local check runner

**Status:** done (34/34 green, typecheck clean, reviewed 2026-09-30)

- [x] Each factual claim cites evidence ID; unknowns/conflicts explicit; disconfirming test stated
- [x] Healthy app + accusatory ticket yields no invented defect
- [x] Prompt injection cannot add tool/action; stale docs cannot support definitive recommendation
- [x] Wrong-deployment logs do not support current diagnosis
