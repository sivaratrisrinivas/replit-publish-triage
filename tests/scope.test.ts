import { describe, it, expect } from "vitest";
import { buildPacket, detectOutOfScope, type PacketCaseData } from "../src/review.js";
import type { DiagnoseOutput } from "../src/diagnose.js";

const diagnosis: DiagnoseOutput = {
  hypotheses: [],
  abstention: "No supplied or observed evidence supports a publishing defect; not reproduced.",
  conflicts: [],
  unknowns: ["timestamp"],
  injectionFlagged: false,
  definitive: false,
  evidenceBar: { passed: false, reason: "test" },
};

const caseData = (ticketText: string): PacketCaseData => ({
  caseId: "w1",
  ticketText,
  environment: "published",
  evidenceRefs: ["w1-ticket"],
});

describe("out-of-scope detection", () => {
  it("finds billing and notification topics with routes", () => {
    const found = detectOutOfScope("You charged my card twice and notification emails stopped.");
    expect(found.map((f) => f.topic)).toContain("billing");
    expect(found.map((f) => f.topic)).toContain("notifications");
    expect(found[0].route.length).toBeGreaterThan(0);
  });

  it("returns empty for a pure publishing ticket", () => {
    expect(detectOutOfScope("Preview works, published login fails with 500.")).toEqual([]);
  });
});

describe("reply scoping", () => {
  it("s07 shape: refund acknowledged, scoped out, routing question added", () => {
    const packet = buildPacket({
      caseData: caseData("Checkout broken, I want a refund within the hour."),
      diagnosis,
    });
    expect(packet.reply).toMatch(/billing/i);
    expect(packet.reply).toMatch(/out of scope|separate|route/i);
    expect(packet.scopeNote).toMatch(/billing/i);
    expect(packet.openQuestions.some((q) => /rout/i.test(q))).toBe(true);
    expect(packet.reply).toContain("no publishing defect established");
  });

  it("s15 shape: billing and email both scoped", () => {
    const packet = buildPacket({
      caseData: caseData("Login seems broken, you charged my card twice, notification emails stopped."),
      diagnosis,
    });
    expect(packet.scopeNote).toMatch(/billing/i);
    expect(packet.scopeNote).toMatch(/notification/i);
  });

  it("publishing path unchanged when no out-of-scope topic present", () => {
    const packet = buildPacket({ caseData: caseData("Preview works, published login fails."), diagnosis });
    expect(packet.scopeNote).toBeNull;
    expect(packet.reply).not.toMatch(/out of scope/i);
  });
});
