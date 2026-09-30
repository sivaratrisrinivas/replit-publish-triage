import { recordLlmCall } from "./llm.js";

export interface GeminiOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface GeminiResult {
  text: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

export async function completeGemini(
  system: string,
  user: string,
  opts: GeminiOptions = {},
): Promise<GeminiResult> {
  const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY ?? "";
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  const model = opts.model ?? process.env.PUBLISH_TRIAGE_GEMINI_MODEL ?? "gemini-3.8-flash";
  const timeoutMs = opts.timeoutMs ?? 30000;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ parts: [{ text: user }] }],
        generationConfig: { temperature: 0 },
      }),
    });
    if (!res.ok) throw new Error(`Gemini request failed: ${res.status}`);
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text) throw new Error("Gemini returned empty content");
    recordLlmCall();
    return {
      text,
      model,
      promptTokens: data.usageMetadata?.promptTokenCount ?? 0,
      completionTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    };
  } finally {
    clearTimeout(timer);
  }
}
