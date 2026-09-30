import { describe, it, expect, beforeEach } from "vitest";
import { rm } from "node:fs/promises";
import { runCase, type RunCaseOutput } from "../src/runCase.js";
import { loadCase, loadEvents } from "../src/store.js";
import type { ConfigSnapshot, Ticket } from "../src/schemas.js";
import missing from "../fixtures/missing-prod-config.json" with { type: "json" };

const DATA_ROOT = ".data-test-pipeline";

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    caseId: "case-pipe-01",
    ticketText: (missing as { ticket: string }).ticket,
    reportedAt: "2026-09-30T00:00:00.000Z",
    source: "seeded",
    ...overrides,
  };
}

function configs() {
  const m = missing as unknown as {
    previewConfig: ConfigSnapshot;
    publishedConfig: ConfigSnapshot;
  };
  return { previewConfig: m.previewConfig, publishedConfig: m.publishedConfig };
}

describe("runCase deterministic pipeline", () => {
  beforeEach(async () => {
    await rm(DATA_ROOT, { recursive: true, force: true });
  });

  it("completes without LLM and saves redacted record plus diff", async () => {
    const { previewConfig, publishedConfig } = configs();
    const out = await runCase({ ticket: ticket(), previewConfig, publishedConfig }, { dataRoot: DATA_ROOT });

    expect(out.diffs.length).toBeGreaterThan(0);
    expect(out.diffs.map((d) => d.field)).toContain("secretsPresentNames");
    expect(out.saved.caseId).toBe("case-pipe-01");

    const loaded = await loadCase<RunCaseOutput["saved"]>("case-pipe-01", DATA_ROOT);
    expect(loaded.caseId).toBe("case-pipe-01");
    expect(JSON.stringify(loaded)).not.toMatch(/PROD_LOGIN_KEY=\S|sk-[A-Za-z0-9]/);

    const events = await loadEvents("case-pipe-01", DATA_ROOT);
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("case.created");
  });

  it("incomplete ticket saves with missing evidence and null facts, no invention", async () => {
    const { previewConfig, publishedConfig } = configs();
    const out = await runCase(
      {
        ticket: ticket({ caseId: "case-incomplete", ticketText: "Preview works, published fails." }),
        previewConfig,
        publishedConfig,
      },
      { dataRoot: DATA_ROOT },
    );
    expect(out.facts.actual).toBeNull;
    expect(out.facts.expected).not.toBeNull;
    expect(out.missingEvidence).toContain("logs");
    expect(out.missingEvidence).toContain("deploymentType");
    // No invented production state
    expect(out.facts.deploymentType).toBeNull;
  });

  it("never persists gold answers from fixture wrapper", async () => {
    const { previewConfig, publishedConfig } = configs();
    const out = await runCase({ ticket: ticket({ caseId: "case-gold" }), previewConfig, publishedConfig }, { dataRoot: DATA_ROOT });
    expect(JSON.stringify(out.saved)).not.toContain("expectedBehavior");
    expect(JSON.stringify(out.saved)).not.toContain("manually verified");
  });

  it("append-only events accumulate across runs", async () => {
    const { previewConfig, publishedConfig } = configs();
    await runCase({ ticket: ticket({ caseId: "case-append" }), previewConfig, publishedConfig }, { dataRoot: DATA_ROOT });
    await runCase({ ticket: ticket({ caseId: "case-append" }), previewConfig, publishedConfig }, { dataRoot: DATA_ROOT });
    const events = await loadEvents("case-append", DATA_ROOT);
    expect(events.length).toBe(2);
  });

  it("redacts secret values in saved ticket text", async () => {
    const { previewConfig, publishedConfig } = configs();
    await runCase(
      {
        ticket: ticket({ caseId: "case-secret", ticketText: "Login fails. api_key=supersecret123" }),
        previewConfig,
        publishedConfig,
      },
      { dataRoot: DATA_ROOT },
    );
    const loaded = await loadCase<RunCaseOutput["saved"]>("case-secret", DATA_ROOT);
    expect(loaded.ticket.ticketText).toContain("[REDACTED]");
    expect(loaded.ticket.ticketText).not.toContain("supersecret123");
  });
});
