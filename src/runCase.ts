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
import { saveCase, appendEvent } from "./store.js";

const RunCaseInputSchema = z.object({
  ticket: TicketSchema,
  previewConfig: ConfigSnapshotSchema,
  publishedConfig: ConfigSnapshotSchema,
  logs: z.array(z.string()).optional(),
});

export interface RunCaseOptions {
  dataRoot?: string;
  now?: string;
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
    evidence: Evidence[];
    extraction: Extraction;
    createdAt: string;
  };
  diffs: ConfigDifference[];
  facts: NormalizedFacts;
  missingEvidence: string[];
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
  ];

  const saved: RunCaseOutput["saved"] = {
    caseId: parsed.ticket.caseId,
    ticket: redactedTicket,
    previewConfig: redactedPreview,
    publishedConfig: redactedPublished,
    facts,
    missingEvidence,
    diffs,
    evidence,
    extraction,
    createdAt: now,
  };

  await saveCase(parsed.ticket.caseId, saved, dataRoot);
  await appendEvent(dataRoot, {
    type: "case.created",
    caseId: parsed.ticket.caseId,
    at: now,
    data: { diffCount: diffs.length, missingCount: missingEvidence.length },
  });

  return { saved, diffs, facts, missingEvidence, evidence, extraction };
}
