import { z } from "zod";
import { normalizeTicket, detectMissingEvidence } from "./normalize.js";
import { redactText } from "./redact.js";

export const ExtractionSchema = z.object({
  symptom: z.string().nullable(),
  expected: z.string().nullable(),
  actual: z.string().nullable(),
  environment: z.string().nullable(),
  timestamp: z.string().nullable(),
  deploymentType: z.string().nullable(),
  spans: z.record(z.string().nullable()),
  conflicts: z.array(z.string()),
  disposition: z.enum(["ready", "needs-evidence", "conflicted"]),
  evidenceRequest: z.array(z.string()),
  provider: z.enum(["deterministic", "llm"]),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

export interface ExtractInput {
  ticketText: string;
  logs?: string[];
}

export interface ExtractOptions {
  llm?: { apiKey?: string };
}

function spanFor(haystack: string, needle: string | null): string | null {
  if (!needle) return null;
  const idx = haystack.toLowerCase().indexOf(needle.toLowerCase().slice(0, 24));
  if (idx === -1) return null;
  return haystack.slice(Math.max(0, idx - 40), idx + 120).trim().slice(0, 200);
}

function detectConflicts(ticketText: string, logs: string[]): string[] {
  const conflicts: string[] = [];
  const lower = ticketText.toLowerCase();
  const claimsPreviewOk = /preview\s+(works|ok|loads|succeeds)/i.test(ticketText);
  const claimsPublishedFail = /publish\w*[^\n.]{0,120}(fail\w*|500|502|503|timeout|not\s+avail\w*|unreach\w*|error)/i.test(
    ticketText,
  );

  const previewFailLog = logs.find((l) => /preview[^\n]{0,80}(500|fail\w*|error|timeout)/i.test(l));
  if (claimsPreviewOk && previewFailLog) {
    conflicts.push(
      "preview status conflict: ticket claims preview works but supplied log reports preview failure",
    );
  }

  const hasSuccess = logs.some((l) => /(200\s*ok|success|passed)/i.test(l) && /publish|login|\//i.test(l));
  const hasFailure = logs.some((l) => /(500|502|503|fail\w*|timeout|error)/i.test(l));
  if (hasSuccess && hasFailure) {
    conflicts.push("log conflict (login route): supplied logs report both success and failure for POST /login; login-route claims are withheld, other routes unaffected");
  }

  const allSuccess = logs.length > 0 && !hasFailure && hasSuccess && claimsPublishedFail;
  if (allSuccess) {
    conflicts.push(
      "diagnosis conflict: ticket reports published failure but supplied logs show only success",
    );
  }

  if (/preview\s+(fails|500|error|broken)/i.test(ticketText) && lower.includes("preview works")) {
    conflicts.push("ticket conflict: ticket claims preview both works and fails");
  }

  return conflicts;
}

export function extractIncident(input: ExtractInput, opts: ExtractOptions = {}): Extraction {
  const ticketText = redactText(input.ticketText ?? "");
  const logs = (input.logs ?? []).map((l) => redactText(l));

  const facts = normalizeTicket(ticketText);
  const missing = detectMissingEvidence(ticketText, facts);
  const conflicts = detectConflicts(ticketText, logs);

  const spans: Record<string, string | null> = {
    symptom: facts.symptom ? ticketText.slice(0, 200) : null,
    expected: spanFor(ticketText, facts.expected),
    actual: spanFor(ticketText, facts.actual),
    environment: spanFor(ticketText, facts.environment),
    timestamp: spanFor(ticketText, facts.timestamp),
    deploymentType: spanFor(ticketText, facts.deploymentType),
  };

  let disposition: Extraction["disposition"] = "ready";
  if (conflicts.length > 0) {
    disposition = "conflicted";
  } else if (!facts.actual || !facts.expected || missing.length >= 2) {
    disposition = "needs-evidence";
  }

  const evidenceRequest =
    disposition === "conflicted"
      ? [
          "clarify which deployment and timestamp each log belongs to",
          "resend complete logs for the failing published deployment",
        ]
      : missing;

  const provider: Extraction["provider"] =
    opts.llm && typeof opts.llm.apiKey === "string" && opts.llm.apiKey.length > 0
      ? "llm"
      : "deterministic";

  const out: Extraction = {
    symptom: facts.symptom,
    expected: facts.expected,
    actual: facts.actual,
    environment: facts.environment,
    timestamp: facts.timestamp,
    deploymentType: facts.deploymentType,
    spans,
    conflicts,
    disposition,
    evidenceRequest,
    provider,
  };
  return ExtractionSchema.parse(out);
}
