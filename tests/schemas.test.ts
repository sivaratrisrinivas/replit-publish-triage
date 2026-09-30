import { describe, it, expect } from "vitest";
import { TicketSchema, ConfigSnapshotSchema, ActionSchema } from "../src/schemas.js";

describe("schemas", () => {
  it("validates ticket and config, rejects bad port", () => {
    expect(() =>
      TicketSchema.parse({ caseId: "c1", ticketText: "hi", reportedAt: "2026-09-30T00:00:00.000Z" }),
    ).not.toThrow();
    expect(() =>
      ConfigSnapshotSchema.parse({
        fixtureId: "x",
        environment: "preview",
        deploymentType: "autoscale",
        startCommand: "npm start",
        host: "0.0.0.0",
        port: -1,
        envVarNames: [],
        secretsPresentNames: [],
      }),
    ).toThrow();
  });

  it("requires uuid idempotency key on actions", () => {
    expect(() =>
      ActionSchema.parse({
        actionId: "a1",
        caseId: "c1",
        target: "mock-zendesk",
        idempotencyKey: "not-a-uuid",
        requestHash: "h",
        promptVersion: "v1",
        sourceDocVersion: "docs-2026-09-30",
        createdAt: "2026-09-30T00:00:00.000Z",
        payload: {},
      }),
    ).toThrow();
  });
});
