import { readFile } from "node:fs/promises";
import { createApp } from "./server.js";
import { runCase } from "./runCase.js";

// Render and most PaaS inject PORT and expect 0.0.0.0, not the loopback default.
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";
const app = createApp({ dataRoot: ".data" });

try {
  const raw = await readFile("fixtures/missing-prod-config.json", "utf8");
  const fixture = JSON.parse(raw) as { ticket: string; previewConfig: never; publishedConfig: never; syntheticLog?: string };
  await runCase(
    {
      ticket: { caseId: "demo-missing-prod", ticketText: fixture.ticket, reportedAt: new Date().toISOString(), source: "seeded" },
      previewConfig: fixture.previewConfig,
      publishedConfig: fixture.publishedConfig,
      ...(fixture.syntheticLog ? { logs: [fixture.syntheticLog] } : {}),
    },
    { dataRoot: ".data" },
  ).catch(() => {});
} catch {
  /* serve whatever is stored */
}

app.listen(port, host, () => console.log(`Publish Triage (SYNTHETIC) at http://${host}:${port}`));
