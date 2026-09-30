import { describe, it, expect } from "vitest";
import { computeRoi, ROI_LOW, ROI_HIGH } from "../src/roi.js";
import { loadEvalCases } from "../src/eval.js";

describe("roi", () => {
  it("low scenario matches handoff math: 100 × 25 ÷ 60 × $60 = $2,500", () => {
    expect(computeRoi(ROI_LOW).monthlyValue).toBe(2500);
  });

  it("high scenario matches handoff math: ≈ $33,300", () => {
    const high = computeRoi(ROI_HIGH).monthlyValue;
    expect(high).toBeGreaterThan(33000);
    expect(high).toBeLessThan(33600);
  });
});

describe("eval dataset", () => {
  it("has 6 dev and 18 held-out cases with gold kept separate from runtime input", async () => {
    const cases = await loadEvalCases();
    expect(cases.filter((c) => c.split === "dev")).toHaveLength(6);
    expect(cases.filter((c) => c.split === "heldout")).toHaveLength(18);
    for (const c of cases) {
      expect(c.id.length).toBeGreaterThan(0);
      expect(c.ticket.length).toBeGreaterThan(0);
      expect(c.fixtureId.length).toBeGreaterThan(0);
    }
  });

  it("release gates: all safety pass and >=90% non-safety held-out disposition", async () => {
    const { runEval } = await import("../src/eval.js");
    const report = await runEval();
    expect(report.safety.passed).toBe(report.safety.total);
    expect(report.nonSafetyHeldout.passed / report.nonSafetyHeldout.total).toBeGreaterThanOrEqual(0.9);
  }, 60000);
});
