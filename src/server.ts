import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { approveReview, rejectReview, buildPacket, exportCaseMarkdown } from "./review.js";
import { computeRoi, ROI_LOW, ROI_HIGH } from "./roi.js";
import { redactText } from "./redact.js";
import type { DiagnoseOutput } from "./diagnose.js";

export interface ServerOptions {
  dataRoot?: string;
  fixturesDir?: string;
}

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

interface QueueRow {
  caseId: string;
  status: string;
  category: string;
  confidence: string;
  lastAction: string;
  timeSaved: string;
}

async function listStoredCases(root: string): Promise<Array<{ caseId: string; record: Record<string, unknown> }>> {
  try {
    const files = await readdir(join(root, "cases"));
    const out: Array<{ caseId: string; record: Record<string, unknown> }> = [];
    for (const f of files.filter((x) => x.endsWith(".json"))) {
      const raw = await readFile(join(root, "cases", f), "utf8");
      out.push({ caseId: f.replace(/\.json$/, ""), record: JSON.parse(raw) as Record<string, unknown> });
    }
    return out;
  } catch {
    return [];
  }
}

async function listSeededFixtures(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
  } catch {
    return [];
  }
}

async function lastActionFor(root: string, caseId: string): Promise<string> {
  try {
    const files = await readdir(join(root, "actions"));
    for (const f of files) {
      const raw = await readFile(join(root, "actions", f), "utf8");
      if ((JSON.parse(raw) as { caseId?: string }).caseId === caseId) return f.replace(/\.json$/, "");
    }
  } catch {
    /* none */
  }
  try {
    await readFile(join(root, "reviews", `${caseId}.json`), "utf8");
    return "reviewed (no action)";
  } catch {
    /* none */
  }
  return "—";
}

function rowForStored(caseId: string, record: Record<string, unknown>, lastAction: string): QueueRow {
  const extraction = (record.extraction ?? {}) as { disposition?: string };
  const diffs = (record.diffs ?? []) as Array<{ field?: string }>;
  const status = extraction.disposition ?? "unknown";
  const category = diffs[0]?.field ?? "unclassified";
  const confidence = status === "conflicted" ? "n/a" : status === "ready" ? "medium (assumption)" : "low (assumption)";
  return { caseId, status, category, confidence, lastAction, timeSaved: "≈25 min (assumption)" };
}

function queueHtml(rows: QueueRow[]): string {
  const trs = rows
    .map(
      (r) =>
        `<tr><td><a href="/case/${esc(r.caseId)}">${esc(r.caseId)}</a></td><td>${esc(r.status)}</td><td>${esc(r.category)}</td><td>${esc(r.confidence)}</td><td>${esc(r.lastAction)}</td><td>${esc(r.timeSaved)}</td></tr>`,
    )
    .join("\n");
  return `<!doctype html><html><head><meta charset="utf8"><title>Publish Triage queue (SYNTHETIC)</title></head><body>
<h1>Publish Triage queue (all data synthetic)</h1>
<table border="1"><tr><th>case</th><th>status</th><th>category</th><th>confidence</th><th>last action</th><th>est. time saved</th></tr>
${trs}</table></body></html>`;
}

function detailHtml(params: {
  caseId: string;
  ticketText: string;
  reported: string[];
  supplied: string[];
  observed: string[];
  inferred: string[];
  reply: string;
  key: string;
}): string {
  const li = (items: string[]) => items.map((i) => `<li>${esc(i)}</li>`).join("\n");
  return `<!doctype html><html><head><meta charset="utf8"><title>Case ${esc(params.caseId)}</title></head><body>
<h1>Case ${esc(params.caseId)} (SYNTHETIC)</h1>
<h2>Ticket</h2><p>${esc(params.ticketText)}</p>
<h2>Customer-reported</h2><ul>${li(params.reported)}</ul>
<h2>Supplied evidence</h2><ul>${li(params.supplied)}</ul>
<h2>Directly observed</h2><ul>${li(params.observed)}</ul>
<h2>Inferred</h2><ul>${li(params.inferred)}</ul>
<h2>Proposed reply (editable)</h2>
<form method="post" action="/case/${esc(params.caseId)}/review">
<textarea name="editedReply" rows="6" cols="80">${esc(params.reply)}</textarea><br>
<label>Target <select name="target"><option value="mock-zendesk">mock-zendesk</option><option value="mock-linear">mock-linear</option></select></label>
<label>Idempotency key <input name="idempotencyKey" size="40" value="${esc(params.key)}"></label><br>
<label>Reviewer <input name="reviewer" value="sam"></label><br>
<button type="submit" name="decision" value="approve">Approve</button>
<button type="submit" name="decision" value="reject">Reject</button>
</form>
<p><a href="/case/${esc(params.caseId)}/export.md">Markdown export</a> · <a href="/case/${esc(params.caseId)}/export.json">JSON export</a> · <a href="/">queue</a></p>
</body></html>`;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export function createApp(opts: ServerOptions = {}): Server {
  const dataRoot = opts.dataRoot ?? ".data";
  const fixturesDir = opts.fixturesDir ?? "fixtures";

  return createServer(async (req, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? "/", "http://local");
      if (req.method === "GET" && url.pathname === "/") {
        const stored = await listStoredCases(dataRoot);
        const seeded = await listSeededFixtures(fixturesDir);
        const rows: QueueRow[] = [];
        for (const { caseId, record } of stored) {
          rows.push(rowForStored(caseId, record, await lastActionFor(dataRoot, caseId)));
        }
        for (const f of seeded.filter((x) => !rows.some((r) => r.caseId === x))) {
          rows.push({ caseId: `seeded:${f}`, status: "seeded", category: "—", confidence: "—", lastAction: "—", timeSaved: "≈25 min (assumption)" });
        }
        res.writeHead(200, { "content-type": "text/html; charset=utf8" }).end(queueHtml(rows));
        return;
      }

      if (req.method === "GET" && url.pathname === "/roi") {
        await roiRoute()(req, res, url);
        return;
      }

      const caseMatch = url.pathname.match(/^\/case\/([^/]+)(\/.*)?$/);
      if (!caseMatch) {
        res.writeHead(404).end("not found");
        return;
      }
      const caseId = decodeURIComponent(caseMatch[1]);
      const suffix = caseMatch[2] ?? "";
      const raw = await readFile(join(dataRoot, "cases", `${caseId}.json`), "utf8").catch(() => null);
      if (!raw) {
        res.writeHead(404).end("unknown case");
        return;
      }
      const record = JSON.parse(raw) as {
        ticket: { ticketText: string };
        diffs: Array<{ field: string }>;
        evidence: Array<{ evidenceId: string; kind: string; content: string }>;
        extraction: { disposition: string; evidenceRequest: string[]; conflicts: string[] };
        facts: Record<string, string | null>;
      };
      const byKind = (kind: string) =>
        record.evidence.filter((e) => e.kind === kind).map((e) => `${e.evidenceId}: ${e.content.slice(0, 200)}`);
      const caseData = {
        caseId,
        ticketText: record.ticket.ticketText,
        environment: "published",
        evidenceRefs: record.evidence.map((e) => e.evidenceId),
      };
      const diagnosis: DiagnoseOutput = {
        hypotheses: [],
        abstention: `Extraction disposition: ${record.extraction.disposition}.`,
        conflicts: record.extraction.conflicts,
        unknowns: record.extraction.evidenceRequest,
        injectionFlagged: false,
        definitive: false,
      };

      if (req.method === "GET" && (suffix === "" || suffix === "/")) {
        const packet = buildPacket({ caseData, diagnosis });
        res
          .writeHead(200, { "content-type": "text/html; charset=utf8" })
          .end(
            detailHtml({
              caseId,
              ticketText: record.ticket.ticketText,
              reported: byKind("customer-reported"),
              supplied: byKind("supplied-evidence"),
              observed: byKind("directly-observed"),
              inferred: [`disposition: ${record.extraction.disposition}`, ...record.extraction.conflicts],
              reply: packet.reply,
              key: randomUUID(),
            }),
          );
        return;
      }

      if (req.method === "POST" && suffix === "/review") {
        const body = new URLSearchParams(await readBody(req));
        const decision = body.get("decision");
        const editedReply = redactText(body.get("editedReply") ?? "");
        const reviewer = body.get("reviewer") ?? "anonymous";
        if (decision === "reject") {
          await rejectReview({ caseId, reviewer, editedReply }, { dataRoot });
          res.writeHead(303, { location: `/case/${encodeURIComponent(caseId)}` }).end();
          return;
        }
        const target = body.get("target") === "mock-linear" ? "mock-linear" : "mock-zendesk";
        const idempotencyKey = body.get("idempotencyKey") ?? randomUUID();
        await approveReview(
          { caseId, reviewer, editedReply, target, idempotencyKey, caseData, diagnosis },
          { dataRoot },
        );
        res.writeHead(303, { location: `/case/${encodeURIComponent(caseId)}` }).end();
        return;
      }

      if (req.method === "GET" && suffix === "/export.md") {
        const md = exportCaseMarkdown({ caseData, diagnosis });
        res.writeHead(200, { "content-type": "text/markdown; charset=utf8" }).end(md);
        return;
      }

      if (req.method === "GET" && suffix === "/export.json") {
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ caseId, evidenceRefs: caseData.evidenceRefs, diagnosis }, null, 2));
        return;
      }

      res.writeHead(404).end("not found");
    } catch (e) {
      res.writeHead(500).end(`error: ${(e as Error).message}`);
    }
  });
}

function roiHtml(params: { eligible: number; minutes: number; cost: number; value: number; formula: string; evalSummary: string }): string {
  return `<!doctype html><html><head><meta charset="utf8"><title>ROI scenario (SYNTHETIC)</title></head><body>
<h1>ROI scenario — capacity value, not cash saved (all inputs synthetic)</h1>
<form method="get" action="/roi">
<label>Eligible incidents/month <input name="eligible" value="${params.eligible}"></label><br>
<label>Minutes saved/incident (assumption) <input name="minutes" value="${params.minutes}"></label><br>
<label>Loaded $/hour (assumption) <input name="cost" value="${params.cost}"></label><br>
<button type="submit">Recompute</button></form>
<p>Formula: ${esc(params.formula)} = <strong>$${params.value.toLocaleString()}/month</strong></p>
<p>Presets: <a href="/roi?eligible=${ROI_LOW.eligiblePerMonth}&minutes=${ROI_LOW.minutesSavedPerIncident}&cost=${ROI_LOW.loadedHourlyCost}">low</a> ·
<a href="/roi?eligible=${ROI_HIGH.eligiblePerMonth}&minutes=${ROI_HIGH.minutesSavedPerIncident}&cost=${ROI_HIGH.loadedHourlyCost}">high</a></p>
<p>The one input to confirm with an insider is eligible incidents/month. Handling-time reduction and hourly cost are also assumptions.</p>
<h2>Eval summary (synthetic cases)</h2><pre>${esc(params.evalSummary)}</pre>
<p>Paired human timings are recorded live during the demo on the same synthetic case; in-code pipeline milliseconds are not handling time.</p>
<p><a href="/">queue</a></p></body></html>`;
}

export function roiRoute(): (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void> {
  return async (_req, res, url) => {
    const num = (v: string | null, fallback: number): number => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? n : fallback;
    };
    const eligible = num(url.searchParams.get("eligible"), ROI_LOW.eligiblePerMonth);
    const minutes = num(url.searchParams.get("minutes"), ROI_LOW.minutesSavedPerIncident);
    const cost = num(url.searchParams.get("cost"), ROI_LOW.loadedHourlyCost);
    const { monthlyValue, formula } = computeRoi({ eligiblePerMonth: eligible, minutesSavedPerIncident: minutes, loadedHourlyCost: cost });
    let evalSummary = "eval/results.json not found — run npm run eval.";
    try {
      const raw = await readFile("eval/results.json", "utf8");
      const r = JSON.parse(raw) as { passed: number; total: number; safety: { passed: number; total: number }; nonSafetyHeldout: { passed: number; total: number }; baseline: { passed: number; total: number }; totalMs: number };
      evalSummary = `passed ${r.passed}/${r.total}; safety ${r.safety.passed}/${r.safety.total}; non-safety held-out ${r.nonSafetyHeldout.passed}/${r.nonSafetyHeldout.total}; baseline ${r.baseline.passed}/${r.baseline.total}; harness ${r.totalMs}ms (in-code, not handling time)`;
    } catch {
      /* leave default */
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf8" }).end(roiHtml({ eligible, minutes, cost, value: monthlyValue, formula, evalSummary }));
  };
}
