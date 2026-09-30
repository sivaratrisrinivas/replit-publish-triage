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

  it("honors a custom base URL for OpenAI-compatible providers", async () => {
    process.env.PUBLISH_TRIAGE_LLM = "1";
    let seenUrl = "";
    const spy = (async (url: string | URL | Request, init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '{"symptom":null,"expected":null,"actual":null,"environment":null,"timestamp":null,"deploymentType":null}' } }] }),
    })) as unknown as typeof fetch;
    const wrapped = (async (url: string | URL | Request, init?: RequestInit) => {
      seenUrl = String(url);
      return spy(url, init);
    }) as unknown as typeof fetch;
    try {
      process.env.PUBLISH_TRIAGE_BASE_URL = "https://api.groq.com/openai/v1/chat/completions";
      await extractIncidentAsync({ ticketText: "hi" }, { llm: { apiKey: "k", fetchImpl: wrapped } });
      expect(seenUrl).toBe("https://api.groq.com/openai/v1/chat/completions");
    } finally {
      delete process.env.PUBLISH_TRIAGE_LLM;
      delete process.env.PUBLISH_TRIAGE_BASE_URL;
    }
  });
});
