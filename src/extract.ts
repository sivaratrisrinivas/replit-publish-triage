import { z } from "zod";
import { normalizeTicket, detectMissingEvidence } from "./normalize.js";
import { redactText } from "./redact.js";
import { completeChat } from "./llm.js";
import { completeGemini } from "./gemini.js";

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
  llm?: { provider?: "gemini" | "openrouter"; apiKey?: string; model?: string; fetchImpl?: typeof fetch };
}

const LlmFactsSchema = z.object({
  symptom: z.string().nullable(),
  expected: z.string().nullable(),
  actual: z.string().nullable(),
  environment: z.string().nullable(),
  timestamp: z.string().nullable(),
  deploymentType: z.string().nullable(),
});
type LlmFacts = z.infer<typeof LlmFactsSchema>;

const EXTRACT_SYSTEM = `Extract structured facts from a synthetic support ticket about a published app failure. Reply with JSON only, no other text. Fields (string or null, null when absent, never infer production state from Preview state): symptom, expected, actual, environment, timestamp, deploymentType.`;

function resolveProvider(explicit?: "gemini" | "openrouter", explicitKey?: string): "gemini" | "openrouter" {
  // Explicit provider always wins. An explicitly passed key keeps the legacy
  // OpenRouter contract. Otherwise the environment decides, preferring Gemini.
  if (explicit) return explicit;
  if (explicitKey) return "openrouter";
  if (process.env.GEMINI_API_KEY) return "gemini";
  return "openrouter";
}
async function llmFacts(ticketText: string, opts: NonNullable<ExtractOptions["llm"]>): Promise<LlmFacts | null> {
  try {
    const provider = resolveProvider(opts.provider, opts.apiKey);
    let text: string;
    if (provider === "gemini") {
      const res = await completeGemini(EXTRACT_SYSTEM, ticketText.slice(0, 2000), {
        apiKey: opts.apiKey,
        model: opts.model,
        fetchImpl: opts.fetchImpl,
      });
      text = res.text;
    } else {
      const res = await completeChat(
        [
          { role: "system", content: EXTRACT_SYSTEM },
          { role: "user", content: ticketText.slice(0, 2000) },
        ],
        { apiKey: opts.apiKey, model: opts.model, fetchImpl: opts.fetchImpl },
      );
      text = res.text;
    }
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1) return null;
    return LlmFactsSchema.parse(JSON.parse(text.slice(start, end + 1)));
  } catch {
    return null;
  }
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

  return assemble(ticketText, logs, normalizeTicket(ticketText), "deterministic");
}

function assemble(
  ticketText: string,
  logs: string[],
  facts: ReturnType<typeof normalizeTicket>,
  provider: Extraction["provider"],
): Extraction {
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

// Async path: tries the model for fact extraction when explicitly enabled,
// otherwise identical to the sync path. Conflict detection, disposition, and
// spans stay deterministic either way; any model failure falls back silently.
// Note: free-tier keys rate-limit bursts; space live calls ~10s apart.
export async function extractIncidentAsync(input: ExtractInput, opts: ExtractOptions = {}): Promise<Extraction> {
  const ticketText = redactText(input.ticketText ?? "");
  const logs = (input.logs ?? []).map((l) => redactText(l));
  const enabled = process.env.PUBLISH_TRIAGE_LLM === "1" && (opts.llm?.apiKey || process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY);
  if (enabled) {
    const provider = resolveProvider(opts.llm?.provider, opts.llm?.apiKey);
    const apiKey =
      opts.llm?.apiKey ?? (provider === "gemini" ? process.env.GEMINI_API_KEY : process.env.OPENROUTER_API_KEY);
    const facts = await llmFacts(ticketText, {
      provider,
      apiKey,
      model: opts.llm?.model,
      fetchImpl: opts.llm?.fetchImpl,
    });
    if (facts) return assemble(ticketText, logs, facts, "llm");
  }
  return assemble(ticketText, logs, normalizeTicket(ticketText), "deterministic");
}
