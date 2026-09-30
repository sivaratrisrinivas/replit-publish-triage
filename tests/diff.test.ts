import { describe, it, expect } from "vitest";
import { diffConfigs } from "../src/diff.js";
import healthy from "../fixtures/healthy.json" with { type: "json" };
import missing from "../fixtures/missing-prod-config.json" with { type: "json" };
import badport from "../fixtures/bad-start-port.json" with { type: "json" };
import type { ConfigSnapshot } from "../src/schemas.js";

describe("diffConfigs", () => {
  it("healthy pair has no diff", () => {
    const d = diffConfigs(
      healthy.previewConfig as ConfigSnapshot,
      healthy.publishedConfig as ConfigSnapshot,
    );
    expect(d).toEqual([]);
  });

  it("missing-prod-config surfaces exact env and secret name diff", () => {
    const d = diffConfigs(
      missing.previewConfig as ConfigSnapshot,
      missing.publishedConfig as ConfigSnapshot,
    );
    const fields = d.map((x) => x.field);
    expect(fields).toContain("envVarNames");
    expect(fields).toContain("secretsPresentNames");
    expect(JSON.stringify(d)).not.toMatch(/PROD_LOGIN_KEY=|sk-/);
  });

  it("bad start/port surfaces startup path without inventing db", () => {
    const d = diffConfigs(
      badport.previewConfig as ConfigSnapshot,
      badport.publishedConfig as ConfigSnapshot,
    );
    const fields = d.map((x) => x.field);
    expect(fields).toContain("startCommand");
    expect(fields).toContain("host");
    expect(fields).toContain("port");
    expect(JSON.stringify(d).toLowerCase()).not.toContain("database");
  });
});
