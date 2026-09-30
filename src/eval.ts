import { readFile, readdir, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { runCase } from "./runCase.js";
import { runChecks, DEFAULT_ALLOWLIST, type FetchImpl } from "./checks.js";
import { diagnose, type DiagnoseOutput } from "./diagnose.js";
import { approveReview } from "./review.js";
import type { ConfigSnapshot } from "./schemas.js";

export interface EvalLog {
  evidenceId: string;
  deployment: string;
  content: string;
}

export interface EvalExpect {
  topCategory?: string;
  secondCategory?: string;
  notTopCategory?: string[];
  disposition?: "ready" | "needs-evidence" | "conflicted";
  noDefect?: boolean;
  mustCite?: string[];
  mustNotCite?: string[];
  mustNotContain?: string[];
  injectionFlagged?: boolean;
  notDefinitive?: boolean;
  idempotentReplay?: boolean;
  allowlistBlocked?: boolean;
  incompleteCheck?: string;
  secretsAbsent?: string[];
  excludedLog?: string;
}

export interface EvalCase {
  id: string;
  split: "dev" | "heldout";
  safety: boolean;
  ticket: string;
  fixtureId: string;
  logs?: EvalLog[];
  probe?: { preview?: number; published?: number; login?: number; loginBody?: string };
  timeoutChecks?: string[];
  allowedChecks: string[];
  publishedUrlOverride?: string;
  docStale?: boolean;
  expected: EvalExpect;
}

export interface CaseResult {
  id: string;
  split: string;
  safety: boolean;
  pass: boolean;
  failures: string[];
  topCategory: string | null;
  disposition: string;
  durationMs: number;
}

export interface EvalReport {
  total: number;
  passed: number;
  failed: number;
  safety: { total: number; passed: number };
  nonSafetyHeldout: { total: number; passed: number };
  baseline: { total: number; passed: number };
  totalMs: number;
  byCase: CaseResult[];
}

export async function loadEvalCases(dir = "eval"): Promise<EvalCase[]> {
  const out: EvalCase[] = [];
  for (const f of (await readdir(dir)).filter((x) => x.startsWith("cases.") && x.endsWith(".json"))) {
    const raw = await readFile(join(dir, f), "utf8");
    out.push(...(JSON.parse(raw) as EvalCase[]));
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

async function loadFixture(dir: string, fixtureId: string): Promise<{ previewConfig: ConfigSnapshot; publishedConfig: ConfigSnapshot }> {
  const raw = await readFile(join(dir, "fixtures", `${fixtureId}.json`), "utf8");
  const parsed = JSON.parse(raw) as { previewConfig: ConfigSnapshot; publishedConfig: ConfigSnapshot };
  return { previewConfig: parsed.previewConfig, publishedConfig: parsed.publishedConfig };
}

function fakeFetch(c: EvalCase): FetchImpl {
  const checkForUrl = (url: string): string => {
    if (/\/login/.test(url)) return "published-login-probe";
    if (/preview/.test(url)) return "preview-http-reachable";
    return "published-http-reachable";
  };
  return async (url: string) => {
    if ((c.timeoutChecks ?? []).includes(checkForUrl(url))) {
      return new Promise(() => {});
    }
    if (/\/login/.test(url)) {
      const status = c.probe?.login ?? 200;
      return { status, body: status >= 500 ? (c.probe?.loginBody ?? "missing PROD_LOGIN_KEY") : "ok" };
    }
    if (/preview/.test(url)) return { status: c.probe?.preview ?? 200, body: "ok" };
    return { status: c.probe?.published ?? 200, body: "ok" };
  };
}

function baselineClassify(diffs: Array<{ field: string }>): string | null {
  const fields = new Set(diffs.map((d) => d.field));
  if (fields.has("secretsPresentNames") || fields.has("envVarNames")) return "missing-production-config";
  if (fields.has("startCommand") || fields.has("host") || fields.has("port")) return "published-startup-config";
  return null;
}

export async function runEvalCase(c: EvalCase, opts: { workspaceRoot?: string; fixturesDir?: string } = {}): Promise<CaseResult> {
  const started = Date.now();
  const root = opts.workspaceRoot ?? ".";
  const dataRoot = join(root, ".data-test-eval", c.id);
  await rm(dataRoot, { recursive: true, force: true });
  await mkdir(dataRoot, { recursive: true });
  const failures: string[] = [];
  const check = (cond: boolean, msg: string) => {
    if (!cond) failures.push(msg);
  };

  const { previewConfig, publishedConfig } = await loadFixture(root, c.fixtureId);
  const logContents = (c.logs ?? []).map((l) => l.content);
  const ran = await runCase(
    {
      ticket: { caseId: c.id, ticketText: c.ticket, reportedAt: "2026-09-30T00:00:00.000Z", source: "seeded" },
      previewConfig,
      publishedConfig,
      ...(logContents.length > 0 ? { logs: logContents } : {}),
    },
    { dataRoot },
  );

  let observations: Awaited<ReturnType<typeof runChecks>> = [];
  let blocked = false;
  try {
    observations = await runChecks(
      {
        caseId: c.id,
        checks: c.allowedChecks,
        previewUrl: previewConfig.publicUrl,
        publishedUrl: c.publishedUrlOverride ?? publishedConfig.publicUrl,
        configs: {
          preview: { startCommand: previewConfig.startCommand, host: previewConfig.host, port: previewConfig.port },
          published: { startCommand: publishedConfig.startCommand, host: publishedConfig.host, port: publishedConfig.port },
        },
      },
      { fetchImpl: fakeFetch(c), allowlist: DEFAULT_ALLOWLIST, timeoutMs: 200 },
    );
  } catch (e) {
    if (e instanceof Error && /allowlist/.test(e.message)) blocked = true;
    else throw e;
  }

  const exp = c.expected;
  if (exp.allowlistBlocked === true) {
    check(blocked, "expected allowlist block, request went through");
    return { id: c.id, split: c.split, safety: c.safety, pass: failures.length === 0, failures, topCategory: null, disposition: ran.extraction.disposition, durationMs: Date.now() - started };
  }

  const diagnosis: DiagnoseOutput = diagnose({
    caseId: c.id,
    ticketText: c.ticket,
    diffs: ran.diffs,
    observations,
    extraction: ran.extraction,
    evidenceIds: ran.evidence.map((e) => e.evidenceId),
    logs: (c.logs ?? []).map((l) => ({ ...l })),
    docVersion: "docs-2026-09-30",
    docStale: c.docStale ?? false,
  });

  const top = diagnosis.hypotheses[0]?.category ?? null;
  const dump = JSON.stringify({ diagnosis, observations });
  const cited = diagnosis.hypotheses.flatMap((h) => h.evidenceIds).join(" ");

  if (exp.topCategory !== undefined) check(top === exp.topCategory, `top category ${top} != ${exp.topCategory}`);
  if (exp.secondCategory !== undefined) {
    check(diagnosis.hypotheses[1]?.category === exp.secondCategory, `second category ${diagnosis.hypotheses[1]?.category} != ${exp.secondCategory}`);
  }
  if (exp.notTopCategory) check(!exp.notTopCategory.includes(top ?? ""), `top category ${top} is excluded`);
  if (exp.disposition !== undefined) check(ran.extraction.disposition === exp.disposition, `disposition ${ran.extraction.disposition} != ${exp.disposition}`);
  if (exp.noDefect === true) {
    check(diagnosis.hypotheses.length === 0, `expected no defect, got ${top}`);
    check((diagnosis.abstention ?? "").length > 0, "expected abstention note");
  }
  for (const s of exp.mustCite ?? []) check(cited.includes(s), `expected citation containing ${s}`);
  for (const s of exp.mustNotCite ?? []) check(!cited.includes(s), `excluded evidence cited: ${s}`);
  for (const s of exp.mustNotContain ?? []) check(!dump.toLowerCase().includes(s.toLowerCase()), `output contains ${s}`);
  if (exp.injectionFlagged === true) check(diagnosis.injectionFlagged, "injection not flagged");
  if (exp.notDefinitive === true) {
    check(!diagnosis.definitive, "expected non-definitive under stale docs");
    check(dump.toLowerCase().includes("stale"), "stale-doc uncertainty missing");
  }
  if (exp.incompleteCheck) {
    check(observations.some((o) => o.checkName === exp.incompleteCheck && o.outcome === "incomplete"), `expected incomplete ${exp.incompleteCheck}`);
  }
  if (exp.secretsAbsent) {
    const saved = JSON.stringify(ran.saved) + dump;
    for (const s of exp.secretsAbsent) check(!saved.includes(s), `secret value leaked: ${s.slice(0, 4)}...`);
  }
  if (exp.idempotentReplay === true) {
    const key = "123e4567-e89b-12d3-a456-426614174099";
    const caseData = { caseId: c.id, ticketText: c.ticket, environment: "published", evidenceRefs: ran.evidence.map((e) => e.evidenceId) };
    const first = await approveReview({ caseId: c.id, reviewer: "eval", editedReply: "ok", target: "mock-zendesk", idempotencyKey: key, caseData, diagnosis }, { dataRoot });
    const second = await approveReview({ caseId: c.id, reviewer: "eval", editedReply: "ok", target: "mock-zendesk", idempotencyKey: key, caseData, diagnosis }, { dataRoot });
    check(first.action.actionId === second.action.actionId, "duplicate approval created a second action");
  }

  await rm(dataRoot, { recursive: true, force: true });
  return { id: c.id, split: c.split, safety: c.safety, pass: failures.length === 0, failures, topCategory: top, disposition: ran.extraction.disposition, durationMs: Date.now() - started };
}

export async function runEval(opts: { workspaceRoot?: string } = {}): Promise<EvalReport> {
  const cases = await loadEvalCases(join(opts.workspaceRoot ?? ".", "eval"));
  const byCase: CaseResult[] = [];
  for (const c of cases) byCase.push(await runEvalCase(c, opts));
  const safety = byCase.filter((r) => r.safety);
  const nonSafetyHeldout = byCase.filter((r) => r.split === "heldout" && !r.safety);
  let baselinePassed = 0;
  let baselineTotal = 0;
  for (const c of cases) {
    if (c.expected.topCategory === undefined || c.expected.allowlistBlocked) continue;
    baselineTotal += 1;
    const { previewConfig, publishedConfig } = await loadFixture(opts.workspaceRoot ?? ".", c.fixtureId);
    const { diffConfigs } = await import("./diff.js");
    if (baselineClassify(diffConfigs(previewConfig, publishedConfig)) === c.expected.topCategory) baselinePassed += 1;
  }
  return {
    total: byCase.length,
    passed: byCase.filter((r) => r.pass).length,
    failed: byCase.filter((r) => !r.pass).length,
    safety: { total: safety.length, passed: safety.filter((r) => r.pass).length },
    nonSafetyHeldout: { total: nonSafetyHeldout.length, passed: nonSafetyHeldout.filter((r) => r.pass).length },
    baseline: { total: baselineTotal, passed: baselinePassed },
    totalMs: byCase.reduce((sum, r) => sum + r.durationMs, 0),
    byCase,
  };
}
