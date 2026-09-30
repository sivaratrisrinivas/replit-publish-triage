import { describe, it, expect, beforeEach, vi } from "vitest";
import { rm } from "node:fs/promises";
import {
  createMockAction,
  ActionConflictError,
  ActionPayloadMismatchError,
} from "../src/actions.js";

const ROOT = ".data-test-actions";

const base = {
  caseId: "a1",
  target: "mock-zendesk" as const,
  payload: { reply: "hello" },
  idempotencyKey: "123e4567-e89b-12d3-a456-426614174000",
  promptVersion: "v1",
  sourceDocVersion: "docs-2026-09-30",
};

describe("mock actions", () => {
  beforeEach(async () => {
    await rm(ROOT, { recursive: true, force: true });
  });

  it("repeat approval with same key and hash creates no duplicate", async () => {
    const first = await createMockAction(base, { dataRoot: ROOT });
    const second = await createMockAction(base, { dataRoot: ROOT });
    expect(second.actionId).toBe(first.actionId);
    expect(second.createdAt).toBe(first.createdAt);
  });

  it("same key with different payload fails loudly (422)", async () => {
    await createMockAction(base, { dataRoot: ROOT });
    await expect(
      createMockAction({ ...base, payload: { reply: "different" } }, { dataRoot: ROOT }),
    ).rejects.toBeInstanceOf(ActionPayloadMismatchError);
  });

  it("in-flight duplicate gets 409", async () => {
    const slowTransport = vi.fn(
      () => new Promise<string>((resolve) => setTimeout(() => resolve("ext-1"), 100)),
    );
    const pending = createMockAction(base, { dataRoot: ROOT, transport: slowTransport });
    await expect(createMockAction(base, { dataRoot: ROOT, transport: slowTransport })).rejects.toBeInstanceOf(
      ActionConflictError,
    );
    await pending;
    expect(slowTransport).toHaveBeenCalledTimes(1);
  });

  it("action record carries evidence refs and timestamp", async () => {
    const action = await createMockAction(
      { ...base, payload: { reply: "hi", evidenceRefs: ["a1-ticket", "a1-config-diff"] } },
      { dataRoot: ROOT },
    );
    expect(action.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect((action.payload as { evidenceRefs: string[] }).evidenceRefs).toContain("a1-ticket");
  });
});
