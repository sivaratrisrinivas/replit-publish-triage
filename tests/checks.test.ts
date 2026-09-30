import { describe, it, expect, vi } from "vitest";
import {
  CHECK_CATALOG,
  selectChecks,
  runChecks,
  DEFAULT_ALLOWLIST,
  type FetchImpl,
} from "../src/checks.js";

const preview = "https://healthy-preview.example.invalid/";
const published = "https://healthy-published.example.invalid/";

describe("check catalog", () => {
  it("lists fixed checks with prerequisites and discrimination rationale", () => {
    expect(CHECK_CATALOG.length).toBeGreaterThanOrEqual(3);
    for (const c of CHECK_CATALOG) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.prerequisites.length).toBeGreaterThan(0);
      expect(c.discriminates.length).toBeGreaterThan(0);
    }
    expect(() => selectChecks({ requested: ["rm -rf /"] as never })).toThrow();
  });

  it("caps selection at three checks", () => {
    const names = CHECK_CATALOG.map((c) => c.name);
    expect(() => selectChecks({ requested: [...names, ...names].slice(0, 4) })).toThrow(/at most 3/);
    const three = selectChecks({ requested: names.slice(0, 3) });
    expect(three.map((c) => c.name)).toHaveLength(3);
  });
});

describe("bounded runner", () => {
  it("non-allowlisted URL receives no request", async () => {
    const fetchSpy = vi.fn(async () => ({ status: 200, body: "ok" }));
    await expect(
      runChecks(
        {
          caseId: "c-evil",
          checks: ["published-http-reachable"],
          previewUrl: preview,
          publishedUrl: "https://evil.example.com/",
        },
        { fetchImpl: fetchSpy, allowlist: DEFAULT_ALLOWLIST, timeoutMs: 500 },
      ),
    ).rejects.toThrow(/allowlist/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("timeout stops and reports incomplete verification", async () => {
    const hanging: FetchImpl = () => new Promise(() => {});
    const out = await runChecks(
      { caseId: "c-timeout", checks: ["published-http-reachable"], previewUrl: preview, publishedUrl: published },
      { fetchImpl: hanging, allowlist: DEFAULT_ALLOWLIST, timeoutMs: 20 },
    );
    expect(out).toHaveLength(1);
    expect(out[0].outcome).toBe("incomplete");
    expect(out[0].detail.toLowerCase()).toContain("timeout");
  });

  it("config audit runs without network and flags bad start/host/port", async () => {
    const fetchSpy = vi.fn(async () => ({ status: 200, body: "ok" }));
    const out = await runChecks(
      {
        caseId: "c-audit",
        checks: ["config-start-port-audit"],
        previewUrl: preview,
        publishedUrl: published,
        configs: {
          preview: { startCommand: "npm start", host: "0.0.0.0", port: 3000 },
          published: { startCommand: "node wrong-entry.js", host: "127.0.0.1", port: 5000 },
        },
      },
      { fetchImpl: fetchSpy, allowlist: DEFAULT_ALLOWLIST, timeoutMs: 500 },
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(out[0].outcome).toBe("fail");
    expect(out[0].detail).toMatch(/startCommand|host|port/);
  });

  it("observations carry evidence ids and no secret values", async () => {
    const fetchImpl: FetchImpl = async () => ({ status: 500, body: "missing PROD_LOGIN_KEY" });
    const out = await runChecks(
      { caseId: "c-login", checks: ["published-login-probe"], previewUrl: preview, publishedUrl: published },
      { fetchImpl, allowlist: DEFAULT_ALLOWLIST, timeoutMs: 500 },
    );
    expect(out[0].evidenceIds).toContain("c-login-obs-published-login-probe");
    expect(JSON.stringify(out)).not.toMatch(/supersecret|sk-[A-Za-z0-9]/);
  });
});
