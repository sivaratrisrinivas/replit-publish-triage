# 01: Fixtures plus schemas plus redaction plus diff

**What to build:** Schemas, three owned fixtures with verified expected behavior, secret redaction, and deterministic Preview-vs-published diff working end-to-end via tests, no LLM required.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Zod schemas for Ticket, ConfigSnapshot, Evidence, Observation, Hypothesis, Review, Action with promptVersion/sourceDocVersion/timestamps/idempotencyKey
- [ ] Three owned fixtures: healthy, missing-prod-config, bad-start-or-port, each with synthetic ticket/log/metadata and expected behavior doc
- [ ] Redaction strips secret-like values before logs/exports; test proves absence
- [ ] Deterministic diff lists exact Preview vs published differences; test on seeded pair
- [ ] `npm test` passes on unit suite
