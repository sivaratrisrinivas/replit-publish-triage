import { describe, it, expect } from "vitest";
import { completeGemini } from "../src/gemini.js";
import { extractIncidentAsync } from "../src/extract.js";

const geminiStub = (text: string) =>
  (async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{ content: { parts: [{ text }] } }],
      usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 15 },
    }),
  })) as unknown as typeof fetch;

describe("gemini adapter", () => {
  it("parses candidates plus usage", async () => {
    const r = await completeGemini("sys", "hi", {
      apiKey: "k",
      fetchImpl: geminiStub('{"a":1}'),
    });
    expect(r.text).toBe('{"a":1}');
    expect(r.promptTokens).toBe(40);
    expect(r.completionTokens).toBe(15);
  });

  it("throws without a key and on empty content", async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(completeGemini("s", "u", { fetchImpl: geminiStub("x") })).rejects.toThrow(/GEMINI_API_KEY/);
    await expect(
      completeGemini("s", "u", { apiKey: "k", fetchImpl: geminiStub("") }),
    ).rejects.toThrow(/empty/);
  });
});

describe("gemini extraction path", () => {
  it("uses gemini facts when provider selected", async () => {
    process.env.PUBLISH_TRIAGE_LLM = "1";
    try {
      const out = await extractIncidentAsync(
        { ticketText: "Preview works, published login fails with 500." },
        {
          llm: {
            provider: "gemini",
            apiKey: "k",
            fetchImpl: geminiStub(
              '{"symptom":"login fails","expected":"preview works","actual":"published login 500","environment":"published","timestamp":null,"deploymentType":null}',
            ),
          },
        },
      );
      expect(out.provider).toBe("llm");
      expect(out.symptom).toBe("login fails");
    } finally {
      delete process.env.PUBLISH_TRIAGE_LLM;
    }
  });
});
