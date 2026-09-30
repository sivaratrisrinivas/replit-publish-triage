import { readFile } from "node:fs/promises";
import { runCase } from "./runCase.js";

const fixturePath = process.argv[2] ?? "fixtures/missing-prod-config.json";
const caseId = process.argv[3] ?? "demo-missing-prod";

const raw = await readFile(fixturePath, "utf8");
const fixture = JSON.parse(raw) as {
  ticket: string;
  previewConfig: unknown;
  publishedConfig: unknown;
  syntheticLog?: string;
};

const logs = fixture.syntheticLog ? [String(fixture.syntheticLog)] : undefined;

const out = await runCase(
  {
    ticket: {
      caseId,
      ticketText: String(fixture.ticket),
      reportedAt: new Date().toISOString(),
      source: "seeded",
    },
    previewConfig: fixture.previewConfig as never,
    publishedConfig: fixture.publishedConfig as never,
    ...(logs ? { logs } : {}),
  },
  { dataRoot: ".data" },
);

console.log(`case ${out.saved.caseId} saved`);
console.log(`diffs: ${out.diffs.map((d) => d.field).join(", ") || "(none)"}`);
console.log(`missing: ${out.missingEvidence.join(", ") || "(none)"}`);
console.log(`disposition: ${out.extraction.disposition}`);
console.log(`facts: ${JSON.stringify(out.facts)}`);
