import { describe, it, expect } from "vitest";
import { extractIncident, ExtractionSchema } from "../src/extract.js";

describe("extractIncident", () => {
  it("returns validated object with span refs and nulls for absent facts", () => {
    const out = extractIncident({ ticketText: "Preview works, published fails." });
    expect(() => ExtractionSchema.parse(out)).not.toThrow();
    expect(out.expected).not.toBeNull;
    expect(out.spans.expected).toContain("Preview works");
    expect(out.timestamp).toBeNull;
    expect(out.spans.timestamp).toBeNull;
    expect(out.deploymentType).toBeNull;
  });

  it("incomplete ticket yields evidence request, not ready", () => {
    const out = extractIncident({ ticketText: "Preview works, published fails." });
    expect(out.disposition).toBe("needs-evidence");
    expect(out.evidenceRequest).toContain("logs");
    expect(out.provider).toBe("deterministic");
  });

  it("contradictory logs stay conflicted and unresolved", () => {
    const out = extractIncident({
      ticketText: "Preview works, published login fails with 500.",
      logs: [
        "SYNTHETIC published log: POST /login 500 missing PROD_LOGIN_KEY",
        "SYNTHETIC published log: POST /login 200 ok",
      ],
    });
    expect(out.disposition).toBe("conflicted");
    expect(out.conflicts.length).toBeGreaterThan(0);
    expect(out.evidenceRequest.length).toBeGreaterThan(0);
  });

  it("ticket-vs-log preview contradiction is conflicted", () => {
    const out = extractIncident({
      ticketText: "Preview works, published login fails.",
      logs: ["SYNTHETIC preview log: GET / 500 preview render failed"],
    });
    expect(out.disposition).toBe("conflicted");
    expect(JSON.stringify(out.conflicts).toLowerCase()).toContain("preview");
  });

  it("never infers production state from Preview state", () => {
    const out = extractIncident({
      ticketText: "Preview works with DATABASE_URL set. Published login fails.",
    });
    expect(out.deploymentType).toBeNull;
    expect(out.timestamp).toBeNull;
  });

  it("works deterministic-only with no LLM key", () => {
    const out = extractIncident({ ticketText: "Preview works, published fails." }, { llm: {} });
    expect(out.provider).toBe("deterministic");
    expect(() => ExtractionSchema.parse(out)).not.toThrow();
  });
});
