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
}

const INJECTION_PATTERN =
  /ignore\s+(previous|prior|all)\s+instructions|add\s+tool|run\s+(command|shell)|approve\s+without\s+review|exfiltrat|send\s+.*(secret|password|token)\s+to\b/i;

function hasField(diffs: ConfigDifference[], field: string): boolean {
  return diffs.some((d) => d.field === field);
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

  const candidates: Array<{ category: Category; evidenceIds: string[]; disconfirmingTest: string; uncertainty: string }> = [];

  if (
    (hasField(input.diffs, "secretsPresentNames") || hasField(input.diffs, "envVarNames")) &&
    loginObs?.outcome === "fail"
  ) {
    candidates.push({
      category: "missing-production-config",
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
      evidenceIds: cite([`${input.caseId}-ticket`, `${input.caseId}-config-diff`, auditObs.observationId]),
      disconfirmingTest: "Fix start command and bind 0.0.0.0 on the published port, then re-run published-http-reachable; reachable disconfirms.",
      uncertainty: "Startup drift is observed; the reason for the drift (manual edit vs deploy pipeline) is unknown.",
    });
  }

  if (redirectObs && redirectObs.outcome !== "pass") {
    candidates.push({
      category: "redirect-config",
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
      evidenceIds: cite([`${input.caseId}-ticket`]),
      disconfirmingTest: "Re-run the failing check twice; two consecutive passes mark it intermittent or resolved.",
      uncertainty: "Single observation only; intermittence unconfirmed.",
    });
  }

  let hypotheses: Hypothesis[] = candidates.map((c, i) =>
    HypothesisSchema.parse({
      hypothesisId: `${input.caseId}-hyp-${i + 1}`,
      category: c.category,
      rank: i + 1,
      evidenceIds: c.evidenceIds.length > 0 ? c.evidenceIds : [`${input.caseId}-ticket`],
      disconfirmingTest: c.disconfirmingTest,
      uncertainty: input.docStale
        ? `${c.uncertainty} Source documentation (${input.docVersion ?? "unknown version"}) is stale and cannot support a definitive recommendation.`
        : c.uncertainty,
    }),
  );

  const healthyPass =
    input.diffs.length === 0 ||
    (loginObs?.outcome === "pass" && !hasField(input.diffs, "startCommand") && auditObs?.outcome !== "fail");
  let abstention: string | null = null;
  if (healthyPass && candidates.length === 0) {
    hypotheses = [];
    abstention =
      "No supplied or observed evidence supports a publishing defect; not reproduced. Ask for failing-route logs before diagnosing.";
  } else if (input.extraction.disposition === "conflicted") {
    abstention = `Unresolved: ${conflicts.join("; ")}. No diagnosis until conflicting evidence is clarified.`;
    hypotheses = [];
  } else if (input.extraction.disposition === "needs-evidence" && candidates.length === 0) {
    abstention = `Insufficient evidence: ${input.extraction.evidenceRequest.join(", ")}. Request evidence instead of guessing.`;
  }

  const definitive =
    hypotheses.length === 1 &&
    hypotheses[0].rank === 1 &&
    !input.docStale &&
    conflicts.length === 0 &&
    (loginObs?.outcome === "fail" || auditObs?.outcome === "fail");

  return { hypotheses, abstention, conflicts, unknowns, injectionFlagged, definitive };
}
