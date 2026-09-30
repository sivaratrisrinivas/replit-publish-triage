# Community batch findings (real public reports, synthetic fixtures)

Sources: Replit community forum ("Why the deplyment is not equal to the preview?", related deploy-outage topics) and the heyopsis environment-bugs writeup. Tickets adapted from real language; each file cites its source URL. Fixtures, logs, and probes stay synthetic. Run: `npx tsx synth/runBatch.ts community/batch1.json community/traces`.

## Per-case outcome

- c01 stale deploy, no errors (forum): abstains, asks for evidence. Correct, invents nothing. Gap noted, not built: no deploy-freshness concept (last-publish timestamp vs ticket time). Smallest honest fix if this recurs: request the Deployments-pane timestamp as evidence.
- c02 dev/prod database split (forum): missing-production-config with cited evidence. Correct.
- c03 weeks-long deploy outage (forum): abstains, blames no app config. Correct. Platform incidents are out of scope by design; the reply path (ticket 10) does not yet name platform status explicitly.
- c04 build/run mismatch (heyopsis): published-startup-config. Correct.
- c05 partial env mismatch, secret missing (heyopsis): missing-production-config. Correct.
- c06 auth redirect loop on live URL (heyopsis): redirect-config with uncertainty. Correct.
- c07 traffic-only DB connections (heyopsis): intermittent-unverified from a single observation. Honest: one probe cannot reproduce load. The disconfirming test (re-run twice) fits.
- c08 dependency drift, missing binary (heyopsis): abstains. Safe. A dedicated environment-drift category would need build-log evidence we do not collect; abstention beats invention.

## New dimensions vs current taxonomy

Build/run mismatch, stale deploy, traffic-only failure, platform outage, and auth loops were absent from the original 24. The pipeline maps three to existing categories, and safely abstains on the other two. No new failure mode found that the current code mishandles. No code changes from this batch.

## What would change that

Real Replit support tickets (private) or a deploy-freshness evidence field. Until then this batch stays a discovery set, not a release gate.
