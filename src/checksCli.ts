import { readFile } from "node:fs/promises";
import { CHECK_CATALOG, runChecks } from "./checks.js";

const fixturePath = process.argv[2] ?? "fixtures/bad-start-port.json";
const raw = await readFile(fixturePath, "utf8");
const fixture = JSON.parse(raw) as {
  previewConfig: { publicUrl?: string; startCommand: string; host: string; port: number };
  publishedConfig: { publicUrl?: string; startCommand: string; host: string; port: number };
};

console.log("catalog:");
for (const c of CHECK_CATALOG) console.log(`- ${c.name} [${c.kind}] discriminates: ${c.discriminates}`);

const observations = await runChecks(
  {
    caseId: "demo-checks",
    checks: ["config-start-port-audit", "preview-http-reachable", "published-http-reachable"],
    previewUrl: fixture.previewConfig.publicUrl,
    publishedUrl: fixture.publishedConfig.publicUrl,
    configs: {
      preview: {
        startCommand: fixture.previewConfig.startCommand,
        host: fixture.previewConfig.host,
        port: fixture.previewConfig.port,
      },
      published: {
        startCommand: fixture.publishedConfig.startCommand,
        host: fixture.publishedConfig.host,
        port: fixture.publishedConfig.port,
      },
    },
  },
  { timeoutMs: 1500 },
);

console.log("observations:");
for (const o of observations) console.log(`- ${o.checkName}: ${o.outcome} -- ${o.detail}`);
