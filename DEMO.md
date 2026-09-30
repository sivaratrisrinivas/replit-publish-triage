# Demo script (all fixtures, tickets, and logs are synthetic)

This is the script the recording actually follows. The recording runs 83 seconds, not three minutes, and it deliberately shows a case where the tool refuses to answer. Do not narrate a confident diagnosis on Case B; the UI will not produce one.

Live instance: https://replit-publish-triage.onrender.com
Recording: `docs/demo/publish-triage-demo.webm`
Local: `npm run eval && npm start`, then http://localhost:3000

The free instance sleeps after 15 minutes idle and takes roughly a minute to wake. Open it before the call, not during. Two seeded cases are created on every boot, so the queue is never empty.

## Case A — a failure it can see (0:00 to 0:40)

Seed: `demo-startup-drift`, from `fixtures/bad-start-port.json`.

1. (0:00) Open the queue. State plainly that every fixture, ticket, and log is synthetic and there are no real customers.
2. (0:04) Open `demo-startup-drift`. The ticket says the published URL times out and the log mentions `listening on 127.0.0.1:5000` via the wrong entrypoint.
3. (0:10) Show the four states: what they said, what was supplied, what was directly observed, what was inferred.
4. (0:18) **Directly observed:** `config-start-port-audit: fail`. This is the load-bearing moment. It is a check that ran, not a restatement of the ticket.
5. (0:26) **Inferred:** `published-startup-config`, rank 1, three citations. Point at the uncertainty line: the drift is observed, but whether a manual edit or the deploy pipeline caused it is unknown.
6. (0:33) Point at the disconfirming test in the reply: fix the start command, bind `0.0.0.0`, re-run `published-http-reachable`; reachable disconfirms.
7. (0:37) Approve. The mock escalation records the observation citation, not just the ticket.

## Case B — a failure it refuses to claim (0:41 to 1:04)

Seed: `demo-missing-prod`, from `fixtures/missing-prod-config.json`.

8. (0:44) Go back to the queue, open the second case. Same shape of report: preview fine, published broken.
9. (0:50) **Directly observed:** `config-start-port-audit: pass`. Start command, host, and port all match, which rules out startup drift.
10. (0:55) The secret set does differ between Preview and published, and the log mentions a 500. That is a tempting diagnosis and the tool does not make it.
11. (1:00) **Inferred:** "No ranked cause survived the observed evidence. Request more before diagnosing." Confirming `missing-production-config` needs `published-login-probe` to actually observe the published login failing, and these fixtures point at `example.invalid`, so it cannot.
12. (1:02) If asked why this is the better demo: a tool that named a cause here would be guessing, and the guess would be indistinguishable from Case A to anyone reading only the summary.

## Close (1:04 to 1:23)

13. (1:05) `/roi`. 24 synthetic eval cases, raw counts, Wilson lower bound. Recompute the three assumptions. Say plainly that it is capacity value, not cash saved, and that eligible incidents per month is the one input an insider has to confirm.
14. (1:15) The two limits worth naming unprompted: the free tier's disk is ephemeral, so audit records do not survive a restart, and the checks that need a reachable URL are opt-in.

## What the demo proves, and what it does not

Proves: the evidence chain is real, every claim carries an evidence ID, the tool abstains rather than inventing, and the eval numbers are reproducible with one command.

Does not prove: any Replit incident rate, any saving, or that the 24 synthetic cases resemble real tickets. The eval fixtures were written by the same author as the code, so 24/24 measures internal consistency, not accuracy in the field. Say so if asked.
