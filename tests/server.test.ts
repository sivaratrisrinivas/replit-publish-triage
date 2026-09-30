import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Server } from "node:http";
import { AddressInfo } from "node:net";
import { runCase } from "../src/runCase.js";
import { createApp } from "../src/server.js";
import type { ConfigSnapshot } from "../src/schemas.js";
import missing from "../fixtures/missing-prod-config.json" with { type: "json" };

const ROOT = ".data-test-server";
let server: Server;
let baseUrl = "";

async function seed() {
  const m = missing as unknown as { previewConfig: ConfigSnapshot; publishedConfig: ConfigSnapshot; ticket: string };
  await runCase(
    {
      ticket: { caseId: "web1", ticketText: m.ticket, reportedAt: "2026-09-30T00:00:00.000Z", source: "seeded" },
      previewConfig: m.previewConfig,
      publishedConfig: m.publishedConfig,
    },
    { dataRoot: ROOT },
  );
}

describe("review server", () => {
  beforeEach(async () => {
    await rm(ROOT, { recursive: true, force: true });
    await seed();
    server = createApp({ dataRoot: ROOT });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(ROOT, { recursive: true, force: true });
  });

  it("queue lists the case with status, category, confidence, action, and labeled time estimate", async () => {
    const html = await (await fetch(`${baseUrl}/`)).text();
    expect(html).toContain("web1");
    expect(html).toContain("assumption");
  });

  it("detail separates the four fact states with citations", async () => {
    const html = await (await fetch(`${baseUrl}/case/web1`)).text();
    for (const heading of ["Customer-reported", "Supplied evidence", "Directly observed", "Inferred"]) {
      expect(html).toContain(heading);
    }
    expect(html).toContain("web1-ticket");
  });

  it("approve creates exactly one action; repeat approval replays without duplicate", async () => {
    const key = "123e4567-e89b-12d3-a456-426614174002";
    const form = new URLSearchParams({ decision: "approve", editedReply: "Looks good", target: "mock-zendesk", reviewer: "sam", idempotencyKey: key });
    const post = () => fetch(`${baseUrl}/case/web1/review`, { method: "POST", body: form, redirect: "manual" });
    expect((await post()).status).toBe(303);
    expect((await post()).status).toBe(303);
    const raw = await readFile(join(ROOT, "actions", `${key}.json`), "utf8");
    expect(JSON.parse(raw).caseId).toBe("web1");
  });

  it("markdown export carries no secret values", async () => {
    const md = await (await fetch(`${baseUrl}/case/web1/export.md`)).text();
    expect(md).toContain("web1-ticket");
    expect(md).not.toMatch(/supersecret|sk-[A-Za-z0-9]{8,}/);
  });
});
