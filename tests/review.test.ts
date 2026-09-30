import { describe, it, expect, beforeEach } from "vitest";
import { rm } from "node:fs/promises";
import { buildPacket, approveReview, rejectReview } from "../src/review.js";
import type { DiagnoseOutput } from "../src/diagnose.js";

const ROOT = ".data-test-review";

const diagnosis: DiagnoseOutput = {
  hypotheses: [
    {
      hypothesisId: "r1-hyp-1",
      category: "missing-production-config",
      rank: 1,
      evidenceIds: ["r1-ticket", "r1-config-diff"],
      disconfirmingTest: "Copy value and re-probe.",
      uncertainty: "Drop step unknown.",
    },
  ],
  abstention: null,
  conflicts: [],
  unknowns: ["timestamp"],
  injectionFlagged: false,
  definitive: false,
};

const caseData = {
  caseId: "r1",
  ticketText: "Preview works, published login fails with 500.",
  environment: "published",
  evidenceRefs: ["r1-ticket", "r1-config-diff"],
};

describe("review packet", () => {
  beforeEach(async () => {
    await rm(ROOT, { recursive: true, force: true });
  });

  it("packet has repro steps, evidence refs, open questions, owner, and no root-cause claim when not definitive", () => {
    const packet = buildPacket({ caseData, diagnosis });
    expect(packet.reproSteps.length).toBeGreaterThan(0);
    expect(packet.evidenceRefs).toContain("r1-ticket");
    expect(packet.openQuestions).toContain("timestamp");
    expect(packet.suggestedOwner.length).toBeGreaterThan(0);
    expect(packet.rootCauseClaim).toBeNull;
    expect(packet.reply).toContain("r1-ticket");
  });

  it("approve creates one auditable action; second approve replays without duplicate", async () => {
    const key = "123e4567-e89b-12d3-a456-426614174001";
    const first = await approveReview(
      { caseId: "r1", reviewer: "sam", editedReply: "Approved reply", target: "mock-linear", idempotencyKey: key, caseData, diagnosis },
      { dataRoot: ROOT },
    );
    expect(first.review.decision).toBe("approve");
    const second = await approveReview(
      { caseId: "r1", reviewer: "sam", editedReply: "Approved reply", target: "mock-linear", idempotencyKey: key, caseData, diagnosis },
      { dataRoot: ROOT },
    );
    expect(second.action.actionId).toBe(first.action.actionId);
  });

  it("reject records review and creates no action", async () => {
    const out = await rejectReview(
      { caseId: "r1", reviewer: "sam", editedReply: "Needs more logs" },
      { dataRoot: ROOT },
    );
    expect(out.review.decision).toBe("reject");
    expect("action" in out).toBe(false);
  });

  it("export text contains no secret values", async () => {
    const { exportCaseMarkdown } = await import("../src/review.js");
    const md = exportCaseMarkdown({
      caseData: { ...caseData, ticketText: "Login fails. api_key=supersecret123" },
      diagnosis,
    });
    expect(md).not.toContain("supersecret123");
    expect(md).toContain("r1-ticket");
  });
});
