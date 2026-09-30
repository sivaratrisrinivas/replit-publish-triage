import { readFile } from "node:fs/promises";
import { createApp } from "./server.js";
import { runCase } from "./runCase.js";
import type { ConfigSnapshot } from "./schemas.js";

// Render and most PaaS inject PORT and expect 0.0.0.0, not the loopback default.
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";
const app = createApp({ dataRoot: ".data" });

// Two seeded cases, because the interesting behaviour is the contrast.
// The startup fixture is observed failing, so the tool names a cause. The
// config-gap fixture passes its only offline check, so the tool declines to.
// A demo that showed only one of those would misrepresent it.
const SEED_CASES = [
  { caseId: "demo-startup-drift", fixture: "fixtures/bad-start-port.json" },
  { caseId: "demo-missing-prod", fixture: "fixtures/missing-prod-config.json" },
];

for (const seed of SEED_CASES) {
  try {
    const fixture = JSON.parse(await readFile(seed.fixture, "utf8")) as {
      ticket: string;
      previewConfig: ConfigSnapshot;
      publishedConfig: ConfigSnapshot;
      syntheticLog?: string;
    };
    await runCase(
      {
        ticket: { caseId: seed.caseId, ticketText: fixture.ticket, reportedAt: new Date().toISOString(), source: "seeded" },
        previewConfig: fixture.previewConfig,
        publishedConfig: fixture.publishedConfig,
        ...(fixture.syntheticLog ? { logs: [fixture.syntheticLog] } : {}),
      },
      { dataRoot: ".data" },
    ).catch(() => {});
  } catch {
    /* serve whatever is stored */
  }
}

app.listen(port, host, () => console.log(`Publish Triage (SYNTHETIC) at http://${host}:${port}`));
