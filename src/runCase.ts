import { z } from "zod";
import {
  TicketSchema,
  ConfigSnapshotSchema,
  type Ticket,
  type ConfigSnapshot,
  type Evidence,
} from "./schemas.js";
import { redactText, redactConfig } from "./redact.js";
import { diffConfigs, type ConfigDifference } from "./diff.js";
import { normalizeTicket, detectMissingEvidence, type NormalizedFacts } from "./normalize.js";
import { extractIncident, type Extraction } from "./extract.js";
import { runChecks } from "./checks.js";
import { saveCase, appendEvent } from "./store.js";
import type { Observation } from "./schemas.js";

const RunCaseInputSchema = z.object({
  ticket: TicketSchema,
  previewConfig: ConfigSnapshotSchema,
  publishedConfig: ConfigSnapshotSchema,
  logs: z.array(z.string()).optional(),
});

// Offline by construction: compares the two config snapshots and touches no
// network, so it is safe to run on every intake. The http probes stay opt-in
// because they need a reachable, allowlisted URL.
const CONFIG_AUDIT_CHECK = "config-start-port-audit";

function pickStartup(c: ConfigSnapshot): { startCommand: string; host: string; port: number } {
  return { startCommand: c.startCommand, host: c.host, port: c.port };
}

export interface RunCaseOptions {
  dataRoot?: string;
  now?: string;
  checks?: string[];
  checkTimeoutMs?: number;
}

export interface RunCaseOutput {
  saved: {
    caseId: string;
    ticket: Ticket;
    previewConfig: ConfigSnapshot;
    publishedConfig: ConfigSnapshot;
    facts: NormalizedFacts;
    missingEvidence: string[];
    diffs: ConfigDifference[];
    observations: Observation[];
    evidence: Evidence[];
    extraction: Extraction;
    createdAt: string;
  };
  diffs: ConfigDifference[];
  facts: NormalizedFacts;
  missingEvidence: string[];
  observations: Observation[];
  evidence: Evidence[];
  extraction: Extraction;
}

export async function runCase(
  input: { ticket: Ticket; previewConfig: ConfigSnapshot; publishedConfig: ConfigSnapshot; logs?: string[] },
  opts: RunCaseOptions = {},
): Promise<RunCaseOutput> {
  const dataRoot = opts.dataRoot ?? ".data";
  const now = opts.now ?? new Date().toISOString();

  const parsed = RunCaseInputSchema.parse(input);

  const redactedTicketText = redactText(parsed.ticket.ticketText);
  const redactedTicket: Ticket = { ...parsed.ticket, ticketText: redactedTicketText };
  const redactedPreview = redactConfig({ ...parsed.previewConfig }) as ConfigSnapshot;
  const redactedPublished = redactConfig({ ...parsed.publishedConfig }) as ConfigSnapshot;

  const diffs = diffConfigs(redactedPreview, redactedPublished);
  const facts = normalizeTicket(redactedTicketText);
  const missingEvidence = detectMissingEvidence(redactedTicketText, facts);
  const redactedLogs = (parsed.logs ?? []).map((l) => redactText(l));
  const extraction = extractIncident({ ticketText: redactedTicketText, logs: redactedLogs });

  // A config difference on its own is not an observation. When a check ran, its
  // result is evidence in its own right and belongs in the record.
  const observations = await runChecks(
    {
      caseId: parsed.ticket.caseId,
      checks: opts.checks ?? [CONFIG_AUDIT_CHECK],
      previewUrl: redactedPreview.publicUrl,
      publishedUrl: redactedPublished.publicUrl,
      configs: {
        preview: pickStartup(redactedPreview),
        published: pickStartup(redactedPublished),
      },
    },
    { timeoutMs: opts.checkTimeoutMs ?? 3000 },
  );

  const evidence: Evidence[] = [
    {
      evidenceId: `${parsed.ticket.caseId}-ticket`,
      kind: "customer-reported",
      citation: "ticket.ticketText",
      content: redactedTicketText.slice(0, 2000),
    },
    ...redactedLogs.map((content, i) => ({
      evidenceId: `${parsed.ticket.caseId}-log-${i + 1}`,
      kind: "supplied-evidence" as const,
      citation: `logs[${i}]`,
      content: content.slice(0, 2000),
    })),
    {
      evidenceId: `${parsed.ticket.caseId}-config-diff`,
      kind: "supplied-evidence",
      citation: "previewConfig vs publishedConfig",
      content: JSON.stringify(diffs).slice(0, 4000),
    },
    ...observations.map((o) => ({
      evidenceId: o.observationId,
      kind: "directly-observed" as const,
      citation: `check:${o.checkName}`,
      content: `${o.outcome}: ${o.detail}`,
    })),
  ];

  const saved: RunCaseOutput["saved"] = {
    caseId: parsed.ticket.caseId,
    ticket: redactedTicket,
    previewConfig: redactedPreview,
    publishedConfig: redactedPublished,
    facts,
    missingEvidence,
    diffs,
    observations,
    evidence,
    extraction,
    createdAt: now,
  };

  await saveCase(parsed.ticket.caseId, saved, dataRoot);
  await appendEvent(dataRoot, {
    type: "case.created",
    caseId: parsed.ticket.caseId,
    at: now,
    data: { diffCount: diffs.length, missingCount: missingEvidence.length, observed: observations.length },
  });

  return { saved, diffs, facts, missingEvidence, observations, evidence, extraction };
}
