import { readFile, rm, mkdir } from "node:fs/promises";
import { runCase } from "../src/runCase.js";
import { runChecks, DEFAULT_ALLOWLIST, type FetchImpl } from "../src/checks.js";
import { diagnose, type DiagnoseOutput } from "../src/diagnose.js";
import { buildPacket, type HandoffPacket } from "../src/review.js";
import type { ConfigSnapshot } from "../src/schemas.js";

export interface SynthTrace {
  diagnosis: DiagnoseOutput;
  disposition: string;
  packet: HandoffPacket;
}

const fakeFetch = (probe?: { preview?: number; published?: number; login?: number }): FetchImpl => async (url: string) => {
  if (/\/login/.test(url)) {
    const s = probe?.login ?? 200;
    return { status: s, body: s >= 500 ? "missing PROD_LOGIN_KEY" : "ok" };
  }
  if (/preview/.test(url)) return { status: probe?.preview ?? 200, body: "ok" };
  return { status: probe?.published ?? 200, body: "ok" };
};

export async function runSynthTrace(itemId: string): Promise<SynthTrace> {
  const item = JSON.parse(await readFile("synth/batch1.json", "utf8")) as Array<{
    id: string;
    ticket: string;
    fixtureId: string;
    logs?: Array<{ evidenceId: string; deployment: string; content: string }>;
    probe?: { preview?: number; published?: number; login?: number };
    allowedChecks: string[];
  }>;
  const found = item.find((x) => x.id === itemId);
  if (!found) throw new Error(`unknown synth item ${itemId}`);
  const dataRoot = `.data-test-modes-${itemId}`;
  await rm(dataRoot, { recursive: true, force: true });
  await mkdir(dataRoot, { recursive: true });
  try {
    const fixture = JSON.parse(await readFile(`fixtures/${found.fixtureId}.json`, "utf8")) as {
      previewConfig: ConfigSnapshot;
      publishedConfig: ConfigSnapshot;
    };
    const ran = await runCase(
      {
        ticket: { caseId: itemId, ticketText: found.ticket, reportedAt: "2026-09-30T00:00:00.000Z", source: "seeded" },
        previewConfig: fixture.previewConfig,
        publishedConfig: fixture.publishedConfig,
        ...(found.logs ? { logs: found.logs.map((l) => l.content) } : {}),
      },
      { dataRoot },
    );
    const observations = await runChecks(
      {
        caseId: itemId,
        checks: found.allowedChecks,
        previewUrl: fixture.previewConfig.publicUrl,
        publishedUrl: fixture.publishedConfig.publicUrl,
        configs: {
          preview: { startCommand: fixture.previewConfig.startCommand, host: fixture.previewConfig.host, port: fixture.previewConfig.port },
          published: { startCommand: fixture.publishedConfig.startCommand, host: fixture.publishedConfig.host, port: fixture.publishedConfig.port },
        },
      },
      { fetchImpl: fakeFetch(found.probe), allowlist: DEFAULT_ALLOWLIST, timeoutMs: 200 },
    );
    const diagnosis = diagnose({
      caseId: itemId,
      ticketText: found.ticket,
      diffs: ran.diffs,
      observations,
      extraction: ran.extraction,
      evidenceIds: ran.evidence.map((e) => e.evidenceId),
      logs: found.logs ?? [],
      docVersion: "docs-2026-09-30",
    });
    const packet = buildPacket({
      caseData: { caseId: itemId, ticketText: found.ticket, environment: "published", evidenceRefs: ran.evidence.map((e) => e.evidenceId) },
      diagnosis,
    });
    return { diagnosis, disposition: ran.extraction.disposition, packet };
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
}
