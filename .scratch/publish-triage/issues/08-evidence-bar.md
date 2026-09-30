# 08: Evidence bar for diagnosis

**What to build:** Vague or minimal tickets cannot yield a ranked diagnosis on probe-only evidence; they need customer-supplied support or multiple independent failing observations, else needs-evidence.

**Blocked by:** None (can start immediately).

**Status:** done (57/57 green incl. 6 bar tests, eval 24/24, synth flips verified, committed)

- [x] Ranked hypothesis requires ≥1 customer-supplied supporting evidence (matching log, config mention) or ≥2 independent failing observations
- [x] s03, s11, s14, s20 yield needs-evidence instead of a ranked diagnosis
- [x] s01, s02, s09, s19 (customer evidence present) still diagnose as before
- [x] Full suite + eval suite stay green; new gate cases added for the bar
