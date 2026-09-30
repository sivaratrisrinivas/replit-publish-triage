import { describe, it, expect } from "vitest";
import { diagnose, type DiagnoseInput } from "../src/diagnose.js";
import type { Extraction } from "../src/extract.js";

function extraction(overrides: Partial<Extraction> = {}): Extraction {
  return {
    symptom: "s",
    expected: "preview works",
    actual: "published login fails with 500 (code 500)",
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

function obs(check: string, outcome: "pass" | "fail" | "incomplete", id: string) {
  return {
    observationId: id,
    checkName: check,
    startedAt: "2026-09-30T00:00:00.000Z",
    finishedAt: "2026-09-30T00:00:01.000Z",
    outcome,
    detail: `${check} ${outcome}`,
    evidenceIds: [id],
  };
}

const LOGIN_CONFLICT = "log conflict (login route): supplied logs report both success and failure for POST /login";

function input(overrides: Partial<DiagnoseInput> = {}): DiagnoseInput {
  return {
    caseId: "c9",
    ticketText: "Preview works. Published shows conflicting signals: POST /login 500s and occasional 200s (code 500 seen).",
    diffs: [
      { field: "envVarNames", preview: ["a"], published: [] },
      { field: "secretsPresentNames", preview: ["a"], published: [] },
      { field: "startCommand", preview: "npm start", published: "node wrong-entry.js" },
      { field: "host", preview: "0.0.0.0", published: "127.0.0.1" },
    ],
    observations: [
      obs("published-login-probe", "fail", "c9-obs-login"),
      obs("config-start-port-audit", "fail", "c9-obs-audit"),
    ],
    extraction: extraction({ disposition: "conflicted", conflicts: [LOGIN_CONFLICT] }),
    evidenceIds: ["c9-ticket", "c9-config-diff"],
    logs: [
      { evidenceId: "c9-log-1", deployment: "current", content: "POST /login 500" },
      { evidenceId: "c9-log-2", deployment: "current", content: "POST /login 200 ok" },
    ],
    ...overrides,
  };
}

describe("scoped conflicts", () => {
  it("s13 shape: startup ranks while the login-route conflict is recorded", () => {
    const out = diagnose(input());
    expect(out.hypotheses[0]?.category).toBe("published-startup-config");
    expect(out.conflicts.join(" ")).toMatch(/login route/i);
    expect(out.abstention).toBeNull;
    expect(out.hypotheses[0].uncertainty).toMatch(/login route/i);
  });

  it("s06 shape: no uncontested evidence keeps the conflicted abstention", () => {
    const out = diagnose(
      input({
        diffs: [{ field: "envVarNames", preview: ["a"], published: [] }],
        observations: [obs("published-login-probe", "fail", "c9-obs-login")],
      }),
    );
    expect(out.hypotheses).toEqual([]);
    expect(out.abstention).toMatch(/unresolved/i);
  });

  it("preview-status conflict still vetoes everything", () => {
    const out = diagnose(
      input({
        extraction: extraction({
          disposition: "conflicted",
          conflicts: ["preview status conflict: ticket claims preview works but log reports preview failure"],
        }),
      }),
    );
    expect(out.hypotheses).toEqual([]);
    expect(out.abstention).toMatch(/unresolved/i);
  });

  it("conflict text names the contested claim explicitly", () => {
    const out = diagnose(input());
    expect(out.conflicts.some((c) => /login route/i.test(c))).toBe(true);
  });
});
