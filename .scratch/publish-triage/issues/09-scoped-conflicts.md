# 09: Scoped conflicts

**What to build:** A log conflict vetoes only the contested claim; uncontested evidence (config diffs, audit failures on other routes) still ranks with the conflict recorded.

**Blocked by:** 08: Evidence bar for diagnosis (same module, sequence to avoid conflicts).

**Status:** done (61/61 green, eval 24/24, synth s13/s18 rank + s06 abstains, committed)

- [x] s13 yields ranked startup hypothesis alongside the recorded login-route conflict instead of full abstention
- [x] s06, s18 keep conflicted disposition only where no uncontested evidence exists
- [x] Conflict text names the contested claim explicitly
- [x] Full suite + eval suite stay green
