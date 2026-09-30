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

const STYLE = `<style>
body{font-family:Georgia,serif;background:#faf7f2;color:#292524;margin:0;line-height:1.5}
main{max-width:680px;margin:0 auto;padding:32px 20px 64px}
a{color:#0c4a6e}
.topnav{font-family:Arial,sans-serif;font-size:13px;color:#78716c;margin-bottom:24px}
.topnav a{color:#78716c}
h1{font-size:28px;margin:0 0 4px}
.sub{color:#78716c;margin:0 0 28px}
.card{background:#fff;border:1px solid #e7e5e4;border-radius:12px;padding:18px 20px;margin:0 0 14px;display:block;text-decoration:none;color:inherit}
.card:hover{border-color:#f59e0b}
.dot{display:inline-block;width:12px;height:12px;border-radius:50%;margin-right:8px}
.dot-amber{background:#d97706}.dot-red{background:#dc2626}.dot-green{background:#16a34a}.dot-grey{background:#a8a29e}
.statusline{font-family:Arial,sans-serif;font-size:15px;font-weight:bold}
.fine{font-family:Arial,sans-serif;font-size:13px;color:#78716c}
.step{background:#fff;border:1px solid #e7e5e4;border-radius:12px;padding:16px 20px;margin:0 0 12px}
.step h2{font-size:17px;margin:0 0 8px}
.verdict{background:#1c1917;color:#faf7f2;border-radius:12px;padding:20px;margin:0 0 20px}
.verdict p{margin:0;font-size:18px}
textarea{width:100%;box-sizing:border-box;font-family:Georgia,serif;font-size:15px;border:1px solid #d6d3d1;border-radius:8px;padding:12px}
button.primary{background:#ea580c;color:#fff;border:none;border-radius:999px;font-size:17px;padding:12px 36px;cursor:pointer;font-family:Arial,sans-serif}
button.primary:hover{background:#c2410c}
.quiet{font-family:Arial,sans-serif;font-size:13px;color:#78716c;background:none;border:none;cursor:pointer;text-decoration:underline;padding:12px}
.bignum{font-size:56px;margin:8px 0}
input,select{font-size:15px;padding:8px;border:1px solid #d6d3d1;border-radius:8px}
label{font-family:Arial,sans-serif;font-size:14px}
</style>`;

const shell = (title: string, crumb: string, body: string): string =>
  `<!doctype html><html><head><meta charset="utf8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>${STYLE}</head><body><main><div class="topnav">${crumb}</div>${body}</main></body></html>`;

const dotFor = (status: string): string =>
  status === "conflicted" ? "dot-red" : status === "ready" ? "dot-green" : status === "seeded" ? "dot-grey" : "dot-amber";

const plainStatus = (status: string): string =>
  status === "needs-evidence" ? "Needs evidence" : status === "conflicted" ? "Stuck on a conflict" : status === "ready" ? "Ready to review" : status === "seeded" ? "Example" : status;

const plainCategory = (category: string): string =>
  category === "secretsPresentNames" || category === "envVarNames"
    ? "production value missing"
    : category === "startCommand" || category === "host" || category === "port"
      ? "startup config drift"
      : category;

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
  const cards = rows
    .map((r) => {
      const href = r.caseId.startsWith("seeded:") ? null : `/case/${esc(r.caseId)}`;
      const inner = `<span class="dot ${dotFor(r.status)}"></span><span class="statusline">${esc(plainStatus(r.status))}</span><br><span class="fine">${esc(r.caseId)} · ${esc(plainCategory(r.category))} · confidence ${esc(r.confidence)} · ${esc(r.lastAction)} · saves ${esc(r.timeSaved)}</span>`;
      return href ? `<a class="card" href="${href}">${inner}</a>` : `<div class="card">${inner}</div>`;
    })
    .join("\n");
  return shell(
    "Publish triage",
    `<a href="/roi">ROI</a>`,
    `<h1>Which case needs you?</h1><p class="sub">All data synthetic. Dots tell the story: amber means the tool is waiting on evidence, red means it is stuck on a conflict, green means it is ready for your call.</p>${cards}`,
  );
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
  const li = (items: string[]) =>
    items.length > 0 ? items.map((i) => `<li>${esc(i)}</li>`).join("\n") : `<li class="fine">nothing here yet</li>`;
  const verdict =
    params.inferred.length > 0
      ? `This is where the evidence points so far. Read the chain, then make the call below.`
      : `No verdict yet. The chain below shows what is missing.`;
  return shell(
    `Case ${params.caseId}`,
    `<a href="/">all cases</a>`,
    `<h1>${esc(params.caseId)}</h1><p class="sub">Synthetic case. One decision: approve the reply or send it back.</p>
<div class="verdict"><p>${verdict}</p></div>
<div class="step"><h2>What they said</h2><p>${esc(params.ticketText)}</p></div>
<div class="step"><h2>Customer-reported</h2><ul>${li(params.reported)}</ul></div>
<div class="step"><h2>Supplied evidence</h2><ul>${li(params.supplied)}</ul></div>
<div class="step"><h2>Directly observed</h2><ul>${li(params.observed)}</ul></div>
<div class="step"><h2>Inferred</h2><ul>${li(params.inferred)}</ul></div>
<div class="step"><h2>Your reply</h2>
<form method="post" action="/case/${esc(params.caseId)}/review">
<textarea name="editedReply" rows="6">${esc(params.reply)}</textarea>
<input type="hidden" name="idempotencyKey" value="${esc(params.key)}">
<p><label>Send as <select name="target"><option value="mock-zendesk">mock-zendesk</option><option value="mock-linear">mock-linear</option></select></label>
<label>Reviewer <input name="reviewer" value="sam" size="10"></label></p>
<p><button class="primary" type="submit" name="decision" value="approve">Approve and file</button>
<button class="quiet" type="submit" name="decision" value="reject">send back</button></p>
</form></div>
<p class="fine"><a href="/case/${esc(params.caseId)}/export.md">Markdown export</a> · <a href="/case/${esc(params.caseId)}/export.json">JSON export</a></p>`,
  );
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
        evidenceBar: { passed: false, reason: "server review path does not re-diagnose" },
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
  return shell(
    "ROI scenario",
    `<a href="/">all cases</a>`,
    `<h1>What is this worth?</h1><p class="sub">Capacity value, not cash saved. Every input below is synthetic until an insider confirms it.</p>
<div class="bignum">$${params.value.toLocaleString()}/mo</div>
<p class="fine">${esc(params.formula)}</p>
<form method="get" action="/roi">
<p><label>Eligible cases per month<br><input name="eligible" value="${params.eligible}"></label></p>
<p><label>Minutes saved each (assumption)<br><input name="minutes" value="${params.minutes}"></label></p>
<p><label>Loaded dollars per hour (assumption)<br><input name="cost" value="${params.cost}"></label></p>
<p><button class="primary" type="submit">Recompute</button></p></form>
<p>Presets: <a href="/roi?eligible=${ROI_LOW.eligiblePerMonth}&minutes=${ROI_LOW.minutesSavedPerIncident}&cost=${ROI_LOW.loadedHourlyCost}">low</a> ·
<a href="/roi?eligible=${ROI_HIGH.eligiblePerMonth}&minutes=${ROI_HIGH.minutesSavedPerIncident}&cost=${ROI_HIGH.loadedHourlyCost}">high</a></p>
<p>The one input to confirm with an insider is eligible cases per month. Handling time and hourly cost are also assumptions.</p>
<h2>Eval summary</h2><p class="fine">${esc(params.evalSummary)}</p>
<p class="fine">Human timings get recorded live during the demo on the same synthetic case. Pipeline milliseconds are not handling time.</p>`,
  );
}

function roiRoute(): (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void> {
  return async (_req, res, url) => {
    // Number(null) is 0, which passes the isFinite guard, so an absent param
    // would silently become zero instead of falling back to the default.
    const num = (v: string | null, fallback: number): number => {
      if (v === null || v.trim() === "") return fallback;
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
