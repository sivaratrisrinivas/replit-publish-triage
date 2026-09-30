export interface LlmMessage {
  role: "system" | "user";
  content: string;
}

export interface LlmResult {
  text: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

export interface LlmOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  endpoint?: string;
}

let callCount = 0;

export function llmCallCount(): number {
  return callCount;
}

export function resetLlmCallCount(): void {
  callCount = 0;
}

export async function completeChat(messages: LlmMessage[], opts: LlmOptions = {}): Promise<LlmResult> {
  const apiKey = opts.apiKey ?? process.env.OPENROUTER_API_KEY ?? "";
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");
  const model = opts.model ?? process.env.PUBLISH_TRIAGE_MODEL ?? "openai/gpt-4o-mini";
  const timeoutMs = opts.timeoutMs ?? 30000;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const endpoint =
    opts.endpoint ?? process.env.PUBLISH_TRIAGE_BASE_URL ?? "https://openrouter.ai/api/v1/chat/completions";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/sivaratrisrinivas/replit-publish-triage",
        "X-Title": "Publish Triage (synthetic eval)",
      },
      body: JSON.stringify({ model, messages }),
    });
    if (!res.ok) throw new Error(`LLM request failed: ${res.status}`);
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      model?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = data.choices?.[0]?.message?.content ?? "";
    if (!text) throw new Error("LLM returned empty content");
    callCount += 1;
    return {
      text,
      model: data.model ?? model,
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
    };
  } finally {
    clearTimeout(timer);
  }
}
