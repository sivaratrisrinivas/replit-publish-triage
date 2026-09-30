import { z } from "zod";
import { HypothesisSchema, type Hypothesis, type Observation } from "./schemas.js";
import type { ConfigDifference } from "./diff.js";
import type { Extraction } from "./extract.js";
import { redactText } from "./redact.js";

const CATEGORY = z.enum([
  "missing-production-config",
  "published-startup-config",
  "redirect-config",
  "intermittent-unverified",
]);
type Category = z.infer<typeof CATEGORY>;

export interface DiagnoseLog {
  evidenceId: string;
  deployment: string;
  content: string;
}

export interface DiagnoseInput {
  caseId: string;
  ticketText: string;
  diffs: ConfigDifference[];
  observations: Observation[];
  extraction: Extraction;
  evidenceIds: string[];
  logs?: DiagnoseLog[];
  docVersion?: string;
  docStale?: boolean;
}

export interface DiagnoseOutput {
  hypotheses: Hypothesis[];
  abstention: string | null;
  conflicts: string[];
  unknowns: string[];
  injectionFlagged: boolean;
  definitive: boolean;
  evidenceBar: { passed: boolean; reason: string };
}

const INJECTION_PATTERN =
  /ignore\s+(previous|prior|all)\s+instructions|add\s+tool|run\s+(command|shell)|approve\s+without\s+review|exfiltrat|send\s+.*(secret|password|token)\s+to\b/i;

// Heuristic: ticket text naming a concrete observable (status code, route behavior,
// binding value, recurrence language) counts as customer-supplied support.
// Keyword-driven, not semantic; see ticket 08.
const CONCRETE_SYMPTOM_PATTERN =
  /500|502|503|404|40[13]|timed?\s*out|200\s*ok|login loop|\bloop\b|redirect|unreachable|never comes up|is down|won't load|doesn't load|not loading|listening on|wrong-entry|\bonce\b|just now|intermittent|flaky|sometimes|occasional/i;

const HEDGE_PATTERN = /\?\?+|\bmaybe\b|\bi think\b|not sure|\bpossibly\b|\bmight\b|could be|\bperhaps\b/i;

function hasField(diffs: ConfigDifference[], field: string): boolean {
  return diffs.some((d) => d.field === field);
}

type Scope = "login-route" | "startup" | "redirect" | "all";

// A conflict vetoes only the scope it contests. Prefixes double as scope tags:
// "log conflict" contests the login route; preview/ticket/diagnosis conflicts
// contest the whole case framing because every category assumes a working preview.
function contestedScopes(conflicts: string[]): Set<Scope> {
  const scopes = new Set<Scope>();
  for (const c of conflicts) {
    const lower = c.toLowerCase();
    if (lower.startsWith("log conflict")) scopes.add("login-route");
    else scopes.add("all");
  }
  return scopes;
}

function evidenceBarCheck(input: {
  ticketText: string;
  currentLogCount: number;
  expected: string | null;
  actual: string | null;
}): { passed: boolean; reason: string } {
  if (input.currentLogCount > 0) return { passed: true, reason: "customer-supplied log for the current deployment" };
  if (CONCRETE_SYMPTOM_PATTERN.test(input.ticketText)) {
    return { passed: true, reason: "ticket names a concrete symptom" };
  }
  const substantial = input.ticketText.length >= 100 && !HEDGE_PATTERN.test(input.ticketText) && (input.expected !== null || input.actual !== null);
  if (substantial) return { passed: true, reason: "detailed unhedged report" };
  if (input.ticketText.length >= 200) return { passed: true, reason: "long detailed report" };
  return { passed: false, reason: "no customer-supplied log, concrete symptom, or detailed report" };
}

function obsByCheck(observations: Observation[], name: string): Observation | undefined {
  return observations.find((o) => o.checkName === name);
}

export function diagnose(input: DiagnoseInput): DiagnoseOutput {
  const ticketText = redactText(input.ticketText ?? "");
  const injectionFlagged = INJECTION_PATTERN.test(ticketText);
  const validIds = new Set(input.evidenceIds);
  for (const o of input.observations) {
    validIds.add(o.observationId);
    for (const id of o.evidenceIds) validIds.add(id);
  }
  const currentLogs = (input.logs ?? []).filter((l) => l.deployment === "current");
  const excludedLogs = (input.logs ?? []).filter((l) => l.deployment !== "current");
  for (const l of currentLogs) validIds.add(l.evidenceId);

  const conflicts = [...input.extraction.conflicts];
  const unknowns: string[] = [];
  if (!input.extraction.timestamp) unknowns.push("timestamp");
  if (!input.extraction.deploymentType) unknowns.push("deploymentType");
  if (excludedLogs.length > 0) {
    unknowns.push(
      `wrong-deployment evidence excluded: ${excludedLogs.map((l) => l.evidenceId).join(", ")}`,
    );
  }

  const cite = (ids: string[]): string[] => ids.filter((id) => validIds.has(id));

  const loginObs = obsByCheck(input.observations, "published-login-probe");
  const auditObs = obsByCheck(input.observations, "config-start-port-audit");
  const redirectObs = obsByCheck(input.observations, "published-redirect-follow");

  const candidates: Array<{ category: Category; scope: Scope; evidenceIds: string[]; disconfirmingTest: string; uncertainty: string }> = [];

  if (
    (hasField(input.diffs, "secretsPresentNames") || hasField(input.diffs, "envVarNames")) &&
    loginObs?.outcome === "fail"
  ) {
    candidates.push({
      category: "missing-production-config",
      scope: "login-route",
      evidenceIds: cite([
        `${input.caseId}-ticket`,
        `${input.caseId}-config-diff`,
        loginObs.observationId,
        ...currentLogs.map((l) => l.evidenceId),
      ]),
      disconfirmingTest: "Copy the named production value to published and re-run published-login-probe; a 200 disconfirms.",
      uncertainty: "Proves a config gap plus observed failure, not which deploy step dropped the value.",
    });
  }

  if (
    (hasField(input.diffs, "startCommand") || hasField(input.diffs, "host") || hasField(input.diffs, "port")) &&
    auditObs?.outcome === "fail"
  ) {
    candidates.push({
      category: "published-startup-config",
      scope: "startup",
      evidenceIds: cite([`${input.caseId}-ticket`, `${input.caseId}-config-diff`, auditObs.observationId]),
      disconfirmingTest: "Fix start command and bind 0.0.0.0 on the published port, then re-run published-http-reachable; reachable disconfirms.",
      uncertainty: "Startup drift is observed; the reason for the drift (manual edit vs deploy pipeline) is unknown.",
    });
  }

  if (redirectObs && redirectObs.outcome !== "pass") {
    candidates.push({
      category: "redirect-config",
      scope: "redirect",
      evidenceIds: cite([`${input.caseId}-ticket`, redirectObs.observationId]),
      disconfirmingTest: "Fetch the published URL with redirect tracing; a direct 200 with no hop disconfirms.",
      uncertainty: redirectObs.outcome === "incomplete" ? "Browser verification incomplete; redirect unconfirmed." : "Redirect behavior observed once; loop vs single hop unknown.",
    });
  }

  if (
    candidates.length === 0 &&
    input.extraction.disposition !== "conflicted" &&
    loginObs?.outcome !== "pass" &&
    (loginObs?.outcome === "fail" || auditObs?.outcome === "fail")
  ) {
    candidates.push({
      category: "intermittent-unverified",
      scope: loginObs?.outcome === "fail" ? "login-route" : "startup",
      evidenceIds: cite([`${input.caseId}-ticket`]),
      disconfirmingTest: "Re-run the failing check twice; two consecutive passes mark it intermittent or resolved.",
      uncertainty: "Single observation only; intermittence unconfirmed.",
    });
  }

  const scoped = contestedScopes(conflicts);
  const survivors = scoped.has("all") ? [] : candidates.filter((c) => !scoped.has(c.scope));
  const conflictNote =
    scoped.size > 0 && !scoped.has("all")
      ? ` Recorded conflict does not apply to this claim: ${conflicts.join("; ")}.`
      : "";

  let hypotheses: Hypothesis[] = survivors.map((c, i) =>
    HypothesisSchema.parse({
      hypothesisId: `${input.caseId}-hyp-${i + 1}`,
      category: c.category,
      rank: i + 1,
      evidenceIds: c.evidenceIds.length > 0 ? c.evidenceIds : [`${input.caseId}-ticket`],
      disconfirmingTest: c.disconfirmingTest,
      uncertainty: (input.docStale
        ? `${c.uncertainty} Source documentation (${input.docVersion ?? "unknown version"}) is stale and cannot support a definitive recommendation.`
        : c.uncertainty) + conflictNote,
    }),
  );

  const healthyPass =
    input.diffs.length === 0 ||
    (loginObs?.outcome === "pass" && !hasField(input.diffs, "startCommand") && auditObs?.outcome !== "fail");
  const bar =
    input.extraction.disposition === "conflicted" || survivors.length === 0
      ? { passed: true, reason: "no ranked diagnosis proposed" }
      : evidenceBarCheck({
          ticketText,
          currentLogCount: currentLogs.length,
          expected: input.extraction.expected,
          actual: input.extraction.actual,
        });
  let abstention: string | null = null;
  if (healthyPass && survivors.length === 0) {
    hypotheses = [];
    abstention =
      "No supplied or observed evidence supports a publishing defect; not reproduced. Ask for failing-route logs before diagnosing.";
  } else if (survivors.length === 0) {
    hypotheses = [];
    // Distinguish the three reasons nothing can be ranked. Folding them into one
    // message either invented a conflict that does not exist or hid the fact
    // that no check ever ran.
    abstention =
      conflicts.length > 0
        ? `Unresolved: ${conflicts.join("; ")}. No diagnosis until conflicting evidence is clarified.`
        : input.observations.length === 0
          ? "No observations were collected, so no cause is asserted. Run the approved checks against the published app, or request failing-route logs."
          : "No ranked cause survived the observed evidence. Request more before diagnosing.";
  } else if (!bar.passed) {
    abstention = `Insufficient customer-supplied support (${bar.reason}). Request evidence instead of guessing.`;
    hypotheses = [];
  }

  const definitive =
    hypotheses.length === 1 &&
    hypotheses[0].rank === 1 &&
    !input.docStale &&
    conflicts.length === 0 &&
    (loginObs?.outcome === "fail" || auditObs?.outcome === "fail");

  return { hypotheses, abstention, conflicts, unknowns, injectionFlagged, definitive, evidenceBar: bar };
}
