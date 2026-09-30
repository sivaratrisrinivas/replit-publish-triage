# 04: Allowlisted local check runner

**What to build:** Named check catalog (max 3 per case) with prerequisites plus local HTTP/Playwright runner that captures bounded observations against owned apps only.

**Blocked by:** 02: Deterministic intake to save

**Status:** ready-for-agent

- [ ] Catalog lists fixed checks with prerequisites and hypothesis-discrimination rationale; no arbitrary commands/URLs
- [ ] URL allowlist + timeouts + run caps enforced in code
- [ ] Browser timeout stops and reports incomplete verification
- [ ] Non-allowlisted URL receives no request (test proves)
