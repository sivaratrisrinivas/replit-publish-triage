import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { runCase } from "../src/runCase.js";
import { runChecks, DEFAULT_ALLOWLIST, type FetchImpl } from "../src/checks.js";
import { diagnose } from "../src/diagnose.js";
import type { ConfigSnapshot } from "../src/schemas.js";

interface BatchItem {
  id: string;
  style: string;
  evidence: string;
  distractor: string;
  fixtureId: string;
  ticket: string;
  logs?: Array<{ evidenceId: string; deployment: string; content: string }>;
  probe?: { preview?: number; published?: number; login?: number };
  allowedChecks: string[];
}

const batch = JSON.parse(await readFile("synth/batch1.json", "utf8")) as BatchItem[];
await mkdir("synth/traces", { recursive: true });

const fakeFetch = (probe: BatchItem["probe"]): FetchImpl => async (url: string) => {
  if (/\/login/.test(url)) {
    const s = probe?.login ?? 200;
    return { status: s, body: s >= 500 ? "missing PROD_LOGIN_KEY" : "ok" };
  }
  if (/preview/.test(url)) return { status: probe?.preview ?? 200, body: "ok" };
  return { status: probe?.published ?? 200, body: "ok" };
};

for (const item of batch) {
  const dataRoot = `synth/data/${item.id}`;
  await rm(dataRoot, { recursive: true, force: true });
  const fixture = JSON.parse(
    await readFile(`fixtures/${item.fixtureId}.json`, "utf8"),
  ) as { previewConfig: ConfigSnapshot; publishedConfig: ConfigSnapshot };
  const ran = await runCase(
    {
      ticket: { caseId: item.id, ticketText: item.ticket, reportedAt: "2026-09-30T00:00:00.000Z", source: "seeded" },
      previewConfig: fixture.previewConfig,
      publishedConfig: fixture.publishedConfig,
      ...(item.logs ? { logs: item.logs.map((l) => l.content) } : {}),
    },
    { dataRoot },
  );
  const observations = await runChecks(
    {
      caseId: item.id,
      checks: item.allowedChecks,
      previewUrl: fixture.previewConfig.publicUrl,
      publishedUrl: fixture.publishedConfig.publicUrl,
      configs: {
        preview: { startCommand: fixture.previewConfig.startCommand, host: fixture.previewConfig.host, port: fixture.previewConfig.port },
        published: { startCommand: fixture.publishedConfig.startCommand, host: fixture.publishedConfig.host, port: fixture.publishedConfig.port },
      },
    },
    { fetchImpl: fakeFetch(item.probe), allowlist: DEFAULT_ALLOWLIST, timeoutMs: 500 },
  );
  const diagnosis = diagnose({
    caseId: item.id,
    ticketText: item.ticket,
    diffs: ran.diffs,
    observations,
    extraction: ran.extraction,
    evidenceIds: ran.evidence.map((e) => e.evidenceId),
    logs: item.logs ?? [],
    docVersion: "docs-2026-09-30",
  });
  await writeFile(
    `synth/traces/${item.id}.json`,
    JSON.stringify({ meta: { style: item.style, evidence: item.evidence, distractor: item.distractor, fixtureId: item.fixtureId }, ticket: item.ticket, diffs: ran.diffs, extraction: ran.extraction, observations, diagnosis }, null, 2),
  );
  await rm(dataRoot, { recursive: true, force: true });
  console.log(`${item.id} [${item.fixtureId}]: disposition=${ran.extraction.disposition} top=${diagnosis.hypotheses[0]?.category ?? "(abstain)"}`);
}
