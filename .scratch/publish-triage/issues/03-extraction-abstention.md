# 03: Extraction plus abstention

**What to build:** Structured extraction (deterministic + LLM contract behind env flag) that quotes ticket spans, uses null for absent facts, never infers prod from Preview, and asks for evidence when insufficient.

**Blocked by:** 02: Deterministic intake to save

**Status:** done (22/22 green, typecheck clean, reviewed 2026-09-30)

- [x] Extractor returns validated object with span refs; nulls for absent facts
- [x] Incomplete-ticket case yields evidence request, not diagnosis
- [x] Contradictory-log case stays unresolved with conflict marked
- [x] Works deterministic-only when no LLM key present
