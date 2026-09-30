import type { ConfigSnapshot } from "./schemas.js";

export interface ConfigDifference {
  field: string;
  preview: unknown;
  published: unknown;
}

function sorted(arr: string[]): string[] {
  return [...arr].sort();
}

function equalNames(a: string[], b: string[]): boolean {
  const sa = sorted(a);
  const sb = sorted(b);
  return sa.length === sb.length && sa.every((v, i) => v === sb[i]);
}

export function diffConfigs(
  preview: ConfigSnapshot,
  published: ConfigSnapshot,
): ConfigDifference[] {
  const diffs: ConfigDifference[] = [];
  const push = (field: string, pv: unknown, pb: unknown) => {
    diffs.push({ field, preview: pv, published: pb });
  };

  if (preview.deploymentType !== published.deploymentType)
    push("deploymentType", preview.deploymentType, published.deploymentType);
  if (preview.startCommand !== published.startCommand)
    push("startCommand", preview.startCommand, published.startCommand);
  if ((preview.buildCommand ?? "") !== (published.buildCommand ?? ""))
    push("buildCommand", preview.buildCommand ?? null, published.buildCommand ?? null);
  if (preview.host !== published.host) push("host", preview.host, published.host);
  if (preview.port !== published.port) push("port", preview.port, published.port);
  if (!equalNames(preview.envVarNames, published.envVarNames))
    push("envVarNames", sorted(preview.envVarNames), sorted(published.envVarNames));
  if (!equalNames(preview.secretsPresentNames, published.secretsPresentNames))
    push(
      "secretsPresentNames",
      sorted(preview.secretsPresentNames),
      sorted(published.secretsPresentNames),
    );
  return diffs;
}
