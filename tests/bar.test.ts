import { describe, it, expect } from "vitest";
import { diagnose, type DiagnoseInput } from "../src/diagnose.js";
import type { Extraction } from "../src/extract.js";

function extraction(overrides: Partial<Extraction> = {}): Extraction {
  return {
    symptom: "s",
    expected: "preview works",
    actual: "published login fails",
    environment: "published",
    timestamp: null,
    deploymentType: null,
    spans: {},
    conflicts: [],
    disposition: "needs-evidence",
    evidenceRequest: ["timestamp"],
    provider: "deterministic",
    ...overrides,
  };
}

function input(overrides: Partial<DiagnoseInput> = {}): DiagnoseInput {
  return {
    caseId: "b1",
    ticketText: "Preview works, published login fails.",
    diffs: [{ field: "secretsPresentNames", preview: ["a"], published: [] }],
    observations: [
      {
        observationId: "b1-obs-published-login-probe",
        checkName: "published-login-probe",
        startedAt: "2026-09-30T00:00:00.000Z",
        finishedAt: "2026-09-30T00:00:01.000Z",
        outcome: "fail",
        detail: "HTTP 500",
        evidenceIds: ["b1-obs-published-login-probe"],
      },
    ],
    extraction: extraction(),
    evidenceIds: ["b1-ticket", "b1-config-diff"],
    ...overrides,
  };
}

describe("evidence bar", () => {
  it("vague short ticket with no logs yields needs-evidence, not a ranked diagnosis", () => {
    const out = diagnose(input({ ticketText: "my app is broken please fix ASAP" }));
    expect(out.hypotheses).toEqual([]);
    expect(out.abstention).toMatch(/needs-evidence|insufficient/i);
    expect(out.evidenceBar.passed).toBe(false);
  });

  it("matching current log clears the bar", () => {
    const out = diagnose(
      input({
        ticketText: "my app is broken please fix ASAP",
        logs: [{ evidenceId: "b1-log-1", deployment: "current", content: "POST /login 500" }],
      }),
    );
    expect(out.hypotheses[0]?.category).toBe("missing-production-config");
    expect(out.evidenceBar.passed).toBe(true);
  });

  it("concrete error code in ticket clears the bar without logs", () => {
    const out = diagnose(input({ ticketText: "Preview works, published login returns 500." }));
    expect(out.hypotheses[0]?.category).toBe("missing-production-config");
  });

  it("hedged vague ticket clears no bar even at medium length", () => {
    const out = diagnose(
      input({ ticketText: "SITE BROKEN after publish!! maybe config?? teammate changed start command i think?? login fails too. help!!!" }),
    );
    expect(out.hypotheses).toEqual([]);
    expect(out.evidenceBar.passed).toBe(false);
  });

  it("long detailed ticket clears the bar without logs", () => {
    const out = diagnose(
      input({
        ticketText:
          "Two problems since publish, and I have checked carefully. First, the login page errors out on every attempt with an error message. Second, sometimes the site does not load at all and the browser spins. Preview is completely fine on all routes. I think the start command might be different on published, and maybe some environment variables did not copy over during the last deployment, but I am not sure which ones are missing.",
      }),
    );
    expect(out.hypotheses.length).toBeGreaterThan(0);
  });

  it("conflicted disposition keeps the conflict abstention, bar does not apply", () => {
    const out = diagnose(
      input({ extraction: extraction({ disposition: "conflicted", conflicts: ["log conflict"] }) }),
    );
    expect(out.hypotheses).toEqual([]);
    expect(out.abstention).toMatch(/unresolved/i);
  });
});
