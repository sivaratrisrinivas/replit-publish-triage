import { ObservationSchema, type Observation } from "./schemas.js";
import { redactText } from "./redact.js";

export interface CheckDefinition {
  name: string;
  kind: "http" | "config" | "browser";
  prerequisites: string[];
  discriminates: string;
}

export const CHECK_CATALOG: CheckDefinition[] = [
  {
    name: "preview-http-reachable",
    kind: "http",
    prerequisites: ["preview publicUrl supplied", "url on allowlist"],
    discriminates: "Preview-down vs publishing-only: a failing preview means the case is not publishing-only.",
  },
  {
    name: "published-http-reachable",
    kind: "http",
    prerequisites: ["published publicUrl supplied", "url on allowlist"],
    discriminates: "Published-unreachable vs app-level failure: distinguishes startup/network from in-app errors.",
  },
  {
    name: "published-login-probe",
    kind: "http",
    prerequisites: ["published publicUrl supplied", "url on allowlist", "synthetic probe only, no customer credentials"],
    discriminates: "Missing production value vs healthy app: a 500 naming a prod-only value supports the config-gap hypothesis.",
  },
  {
    name: "config-start-port-audit",
    kind: "config",
    prerequisites: ["preview and published ConfigSnapshots supplied"],
    discriminates: "Startup path vs unrelated causes: startCommand/host/port drift supports the startup hypothesis without database claims.",
  },
  {
    name: "published-redirect-follow",
    kind: "browser",
    prerequisites: ["published publicUrl supplied", "url on allowlist", "worker execution for real browser runs"],
    discriminates: "Redirect misconfiguration vs app failure: a single redirect hop that lands off-allowlist or loops supports the redirect hypothesis.",
  },
];

const CATALOG_BY_NAME = new Map(CHECK_CATALOG.map((c) => [c.name, c]));

export const MAX_CHECKS_PER_CASE = 3;

export const DEFAULT_ALLOWLIST: string[] = ["example.invalid", "localhost", "127.0.0.1"];

export function selectChecks(input: { requested: string[] }): CheckDefinition[] {
  if (input.requested.length > MAX_CHECKS_PER_CASE) {
    throw new Error(`select at most ${MAX_CHECKS_PER_CASE} checks per case`);
  }
  return input.requested.map((name) => {
    const found = CATALOG_BY_NAME.get(name);
    if (!found) throw new Error(`unknown check: ${name} (no arbitrary commands or URLs)`);
    return found;
  });
}

export type FetchImpl = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<{ status: number; body: string }>;

const defaultFetch: FetchImpl = async (url, init) => {
  const res = await fetch(url, { signal: init.signal, redirect: "manual" });
  const body = await res.text().catch(() => "");
  return { status: res.status, body: body.slice(0, 2000) };
};

export interface RunChecksInput {
  caseId: string;
  checks: string[];
  previewUrl?: string;
  publishedUrl?: string;
  configs?: {
    preview: { startCommand: string; host: string; port: number };
    published: { startCommand: string; host: string; port: number };
  };
}

export interface RunChecksOptions {
  fetchImpl?: FetchImpl;
  allowlist?: string[];
  timeoutMs?: number;
  now?: () => string;
}

function urlFor(check: string, input: RunChecksInput): string | null {
  if (check === "preview-http-reachable") return input.previewUrl ?? null;
  if (check === "config-start-port-audit") return null;
  if (check === "published-login-probe") {
    if (!input.publishedUrl) return null;
    return input.publishedUrl.replace(/\/$/, "") + "/login";
  }
  return input.publishedUrl ?? null;
}

function isAllowlisted(url: string, allowlist: string[]): boolean {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return allowlist.some((suffix) => host === suffix.toLowerCase() || host.endsWith(`.${suffix.toLowerCase()}`));
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms: incomplete verification`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer!)) as Promise<T>;
}

function auditStartPort(input: RunChecksInput): { outcome: Observation["outcome"]; detail: string } {
  if (!input.configs) {
    return { outcome: "incomplete", detail: "config-start-port-audit needs preview and published configs" };
  }
  const problems: string[] = [];
  const { preview, published } = input.configs;
  if (preview.startCommand !== published.startCommand) {
    problems.push(`startCommand differs: preview=${preview.startCommand} published=${published.startCommand}`);
  }
  if (preview.host !== published.host) problems.push(`host differs: preview=${preview.host} published=${published.host}`);
  if (preview.port !== published.port) problems.push(`port differs: preview=${preview.port} published=${published.port}`);
  if (published.host === "127.0.0.1" || published.host === "localhost") {
    problems.push(`published binds loopback (${published.host}); unreachable from public URL`);
  }
  if (problems.length === 0) return { outcome: "pass", detail: "start command, host, and port match" };
  return { outcome: "fail", detail: problems.join("; ").slice(0, 1000) };
}

export async function runChecks(input: RunChecksInput, opts: RunChecksOptions = {}): Promise<Observation[]> {
  const allowlist = opts.allowlist ?? DEFAULT_ALLOWLIST;
  const timeoutMs = opts.timeoutMs ?? 3000;
  const fetchImpl = opts.fetchImpl ?? defaultFetch;
  const now = opts.now ?? (() => new Date().toISOString());

  const defs = selectChecks({ requested: input.checks });
  const observations: Observation[] = [];

  for (const def of defs) {
    const startedAt = now();
    const evidenceId = `${input.caseId}-obs-${def.name}`;
    try {
      if (def.kind === "config") {
        const { outcome, detail } = auditStartPort(input);
        const finishedAt = now();
        observations.push(
          ObservationSchema.parse({
            observationId: evidenceId,
            checkName: def.name,
            startedAt,
            finishedAt,
            outcome,
            detail: redactText(detail),
            evidenceIds: [evidenceId],
          }),
        );
        continue;
      }

      if (def.kind === "browser") {
        const finishedAt = now();
        observations.push(
          ObservationSchema.parse({
            observationId: evidenceId,
            checkName: def.name,
            startedAt,
            finishedAt,
            outcome: "incomplete",
            detail: "browser check requires worker execution; local stub reports incomplete verification",
            evidenceIds: [evidenceId],
          }),
        );
        continue;
      }

      const url = urlFor(def.name, input);
      if (!url) {
        const finishedAt = now();
        observations.push(
          ObservationSchema.parse({
            observationId: evidenceId,
            checkName: def.name,
            startedAt,
            finishedAt,
            outcome: "incomplete",
            detail: `missing url for ${def.name}: incomplete verification`,
            evidenceIds: [evidenceId],
          }),
        );
        continue;
      }
      if (!isAllowlisted(url, allowlist)) {
        throw new Error(`blocked: ${url} is not on the allowlist (no request sent)`);
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res: { status: number; body: string };
      try {
        res = await withTimeout(fetchImpl(url, { signal: controller.signal }), timeoutMs);
      } catch (e) {
        controller.abort();
        if (e instanceof Error && /timeout/i.test(e.message)) {
          throw new Error(`${def.name}: timeout after ${timeoutMs}ms: incomplete verification`);
        }
        if (controller.signal.aborted) {
          throw new Error(`${def.name}: timeout after ${timeoutMs}ms: incomplete verification`);
        }
        throw e;
      } finally {
        clearTimeout(timer);
      }
      const finishedAt = now();
      const outcome: Observation["outcome"] = res.status >= 200 && res.status < 400 ? "pass" : "fail";
      observations.push(
        ObservationSchema.parse({
          observationId: evidenceId,
          checkName: def.name,
          startedAt,
          finishedAt,
          outcome,
          detail: redactText(`${def.name}: HTTP ${res.status} at ${url} body=${res.body.slice(0, 300)}`),
          evidenceIds: [evidenceId],
        }),
      );
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("blocked:")) throw e;
      const finishedAt = now();
      const detail =
        e instanceof Error && /timeout/i.test(e.message)
          ? `${def.name}: timeout after ${timeoutMs}ms: incomplete verification`
          : `${def.name}: ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}: incomplete verification`;
      observations.push(
        ObservationSchema.parse({
          observationId: evidenceId,
          checkName: def.name,
          startedAt,
          finishedAt,
          outcome: "incomplete",
          detail: redactText(detail),
          evidenceIds: [evidenceId],
        }),
      );
    }
  }

  return observations;
}
