# 09: Scoped conflicts

**What to build:** A log conflict vetoes only the contested claim; uncontested evidence (config diffs, audit failures on other routes) still ranks with the conflict recorded.

**Blocked by:** 08: Evidence bar for diagnosis (same module, sequence to avoid conflicts).

**Status:** ready-for-agent

- [ ] s13 yields ranked startup hypothesis alongside the recorded login-route conflict instead of full abstention
- [ ] s06, s18 keep conflicted disposition only where no uncontested evidence exists
- [ ] Conflict text names the contested claim explicitly
- [ ] Full suite + eval suite stay green
