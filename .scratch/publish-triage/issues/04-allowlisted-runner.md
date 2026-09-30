# 04: Allowlisted local check runner

**What to build:** Named check catalog (max 3 per case) with prerequisites plus local HTTP/Playwright runner that captures bounded observations against owned apps only.

**Blocked by:** 02: Deterministic intake to save

**Status:** done (28/28 green, typecheck clean, reviewed + committed 2026-09-30 as f6c1f42)

- [x] Catalog lists fixed checks with prerequisites and hypothesis-discrimination rationale; no arbitrary commands/URLs
- [x] URL allowlist + timeouts + run caps enforced in code
- [x] Browser timeout stops and reports incomplete verification
- [x] Non-allowlisted URL receives no request (test proves)
