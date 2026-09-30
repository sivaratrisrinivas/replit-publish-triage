# 07: Eval baseline ROI demo packaging

**What to build:** 24-case dataset (6 dev + 18 held-out), 18 acceptance checks, deterministic-only baseline compare, editable ROI scenario, timings, README + 3-min demo script.

**Blocked by:** 06: Queue detail review mock action

**Status:** done (51/51 green incl. release gates, eval 24/24, committed 2026-09-30)

- [x] All safety cases pass; factual diagnoses cite valid evidence; >=90% disposition on non-safety held-out with raw n/d reported
- [x] Baseline comparison shows where LLM earns place (ambiguous intake/evidence-request/handoff)
- [x] ROI formula editable with labeled assumptions; paired baseline-vs-prototype timings shown separately
- [x] README states what is built, what is synthetic, which ROI inputs need Replit confirmation
