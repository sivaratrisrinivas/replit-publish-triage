import { describe, it, expect, beforeEach } from "vitest";
import { rm } from "node:fs/promises";
import { runCase } from "../src/runCase.js";
import type { ConfigSnapshot, Ticket } from "../src/schemas.js";
import missing from "../fixtures/missing-prod-config.json" with { type: "json" };

const DATA_ROOT = ".data-test-extract-int";

function ticket(text: string, caseId: string): Ticket {
  return { caseId, ticketText: text, reportedAt: "2026-09-30T00:00:00.000Z", source: "seeded" };
}

function configs() {
  const m = missing as unknown as { previewConfig: ConfigSnapshot; publishedConfig: ConfigSnapshot };
  return m;
}

describe("runCase extraction wiring", () => {
  beforeEach(async () => {
    await rm(DATA_ROOT, { recursive: true, force: true });
  });

  it("incomplete case yields needs-evidence extraction, not a diagnosis", async () => {
    const { previewConfig, publishedConfig } = configs();
    const out = await runCase(
      { ticket: ticket("Preview works, published fails.", "ex-incomplete"), previewConfig, publishedConfig },
      { dataRoot: DATA_ROOT },
    );
    expect(out.extraction.disposition).toBe("needs-evidence");
    expect(out.extraction.evidenceRequest).toContain("logs");
    expect(out.saved.extraction.disposition).toBe("needs-evidence");
  });

  it("contradictory logs persist as conflicted with log evidence", async () => {
    const { previewConfig, publishedConfig } = configs();
    const out = await runCase(
      {
        ticket: ticket("Preview works, published login fails with 500.", "ex-conflict"),
        previewConfig,
        publishedConfig,
        logs: ["POST /login 500 fail", "POST /login 200 ok"],
      },
      { dataRoot: DATA_ROOT },
    );
    expect(out.extraction.disposition).toBe("conflicted");
    expect(out.evidence.some((e) => e.evidenceId.endsWith("-log-1"))).toBe(true);
  });
});
