import { describe, it, expect } from "vitest";
import { runSynthTrace } from "./synthHarness.js";

// Regression locks for the error-discovery modes (tickets 08/09/10).
// Each replays the original synth trace through the current pipeline.
describe("mode A: evidence bar on vague tickets", () => {
  for (const id of ["s03", "s11", "s14", "s20"]) {
    it(`${id} yields needs-evidence abstention, not a ranked diagnosis`, async () => {
      const t = await runSynthTrace(id);
      expect(t.diagnosis.hypotheses).toEqual([]);
      expect(t.diagnosis.abstention).toMatch(/insufficient/i);
      expect(t.diagnosis.evidenceBar.passed).toBe(false);
    });
  }
});

describe("mode B: scoped conflicts", () => {
  it("s06 keeps the conflicted abstention (nothing uncontested)", async () => {
    const t = await runSynthTrace("s06");
    expect(t.disposition).toBe("conflicted");
    expect(t.diagnosis.hypotheses).toEqual([]);
  });

  it("s13 ranks startup with the login-route conflict recorded", async () => {
    const t = await runSynthTrace("s13");
    expect(t.diagnosis.hypotheses[0]?.category).toBe("published-startup-config");
    expect(t.diagnosis.conflicts.join(" ")).toMatch(/login route/i);
  });
});

describe("mode C: out-of-scope replies", () => {
  it("s07 scopes out the refund demand", async () => {
    const t = await runSynthTrace("s07");
    expect(t.packet.scopeNote).toMatch(/billing/i);
  });

  it("s15 scopes out billing and notifications", async () => {
    const t = await runSynthTrace("s15");
    expect(t.packet.scopeNote).toMatch(/billing/i);
    expect(t.packet.scopeNote).toMatch(/notification/i);
  });
});
