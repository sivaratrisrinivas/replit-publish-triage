import { describe, it, expect } from "vitest";
import { redactText, redactRecord, containsSecretLike } from "../src/redact.js";

describe("redact", () => {
  it("strips assignment secrets but keeps names", () => {
    const out = redactText("api_key=abc123XYZ and user ok");
    expect(out).toContain("api_key=[REDACTED]");
    expect(out).not.toContain("abc123XYZ");
  });

  it("strips bearer-style tokens", () => {
    const out = redactText("Authorization: Bearer abcdefgh12345678");
    expect(out).not.toContain("abcdefgh12345678");
  });

  it("redacts secret-named keys in objects", () => {
    const out = redactRecord({ SESSION_SECRET: "shh", port: 3000 } as Record<string, unknown>);
    expect(out["SESSION_SECRET"]).toBe("[REDACTED]");
    expect(out["port"]).toBe(3000);
  });

  it("detects secret-like strings for export guard", () => {
    expect(containsSecretLike("token=abc123xyz")).toBe(true);
    expect(containsSecretLike("listening on 0.0.0.0:3000")).toBe(false);
  });
});
