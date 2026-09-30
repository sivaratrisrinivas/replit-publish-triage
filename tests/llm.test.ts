import { describe, it, expect } from "vitest";
import { extractIncidentAsync } from "../src/extract.js";

const stubFetch = (text: string) =>
  (async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: text } }],
      model: "stub-model",
      usage: { prompt_tokens: 50, completion_tokens: 20 },
    }),
  })) as unknown as typeof fetch;

describe("llm extraction path", () => {
  it("uses model facts and marks provider llm", async () => {
    process.env.PUBLISH_TRIAGE_LLM = "1";
    try {
      const out = await extractIncidentAsync(
        { ticketText: "Preview works, published login fails with 500." },
        {
          llm: {
            apiKey: "test-key",
            fetchImpl: stubFetch(
              '{"symptom":"login fails","expected":"preview works","actual":"published login 500","environment":"published","timestamp":null,"deploymentType":null}',
            ),
          },
        },
      );
      expect(out.provider).toBe("llm");
      expect(out.symptom).toBe("login fails");
      expect(out.spans.expected).toContain("Preview works");
    } finally {
      delete process.env.PUBLISH_TRIAGE_LLM;
    }
  });

  it("falls back to deterministic when the model fails", async () => {
    process.env.PUBLISH_TRIAGE_LLM = "1";
    try {
      const out = await extractIncidentAsync(
        { ticketText: "Preview works, published fails." },
        { llm: { apiKey: "test-key", fetchImpl: (async () => { throw new Error("down"); }) as unknown as typeof fetch } },
      );
      expect(out.provider).toBe("deterministic");
      expect(out.expected).not.toBeNull;
    } finally {
      delete process.env.PUBLISH_TRIAGE_LLM;
    }
  });

  it("stays deterministic when the flag is off even with a key", async () => {
    delete process.env.PUBLISH_TRIAGE_LLM;
    const out = await extractIncidentAsync(
      { ticketText: "Preview works, published fails." },
      { llm: { apiKey: "test-key", fetchImpl: stubFetch("{}") } },
    );
    expect(out.provider).toBe("deterministic");
  });
});
