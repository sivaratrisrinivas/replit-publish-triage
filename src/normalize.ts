export interface NormalizedFacts {
  symptom: string | null;
  expected: string | null;
  actual: string | null;
  environment: string | null;
  timestamp: string | null;
  deploymentType: string | null;
}

const ISO_PATTERN = /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?/;
const DEPLOY_PATTERN = /\b(autoscale|reserved-?vm|static|scheduled)\b/i;
const ENV_PATTERN = /\b(preview|published|production|prod)\b/i;

export function normalizeTicket(ticketText: string): NormalizedFacts {
  const text = ticketText ?? "";
  const firstSentence = text.split(/(?<=[.!?])\s+/)[0]?.slice(0, 280) ?? "";

  const hasPreviewOk = /preview\s+(works|ok|loads|succeeds)/i.test(text);
  const actualMatch = text.match(/publish\w*[^\n.]{0,120}(fail\w*|500|502|503|timeout|timed out|not\s+avail\w*|unreach\w*|never comes up|is down|won't load|doesn't load|not loading|error)/i);

  const tsMatch = text.match(ISO_PATTERN);
  const deployMatch = text.match(DEPLOY_PATTERN);
  const envMatch = text.match(ENV_PATTERN);

  return {
    symptom: firstSentence ? firstSentence : null,
    expected: hasPreviewOk ? "preview works" : null,
    actual: actualMatch ? actualMatch[0].trim().slice(0, 280) : null,
    environment: envMatch ? envMatch[0].toLowerCase() : null,
    timestamp: tsMatch ? tsMatch[0] : null,
    deploymentType: deployMatch ? deployMatch[0].toLowerCase().replace("-", "-") : null,
  };
}

export function detectMissingEvidence(ticketText: string, facts: NormalizedFacts): string[] {
  const missing: string[] = [];
  const lower = ticketText.toLowerCase();
  if (!facts.timestamp) missing.push("timestamp");
  if (!facts.deploymentType) missing.push("deploymentType");
  if (!/log/.test(lower)) missing.push("logs");
  if (!/(start|command|entrypoint)/.test(lower)) missing.push("startCommand");
  if (!/(port|host|bind)/.test(lower)) missing.push("hostPortBinding");
  if (!/(secret|env|config|variable)/.test(lower)) missing.push("prodConfigValues");
  if (!facts.actual) missing.push("actualBehavior");
  return missing;
}
