const SECRET_KEY_PATTERN =
  /(api[_-]?key|secret|password|passwd|token|private[_-]?key|client[_-]?secret|access[_-]?key)/i;

const BEARER_PATTERN = /\b(Bearer\s+[A-Za-z0-9\-._~+/=]{8,}|sk-[A-Za-z0-9\-_]{8,}|xox[bap]-[A-Za-z0-9\-_]{8,})\b/g;

const ASSIGNMENT_PATTERN =
  /((?:api[_-]?key|secret|password|passwd|token|private[_-]?key|client[_-]?secret)\s*[:=]\s*)(['"]?)([^\s'";,]+)\2/gi;

export function redactText(input: string): string {
  if (!input) return input;
  let out = input.replace(ASSIGNMENT_PATTERN, "$1$2[REDACTED]$2");
  out = out.replace(BEARER_PATTERN, "[REDACTED]");
  return out;
}

export function redactRecord<T extends Record<string, unknown>>(obj: T): T {
  const clone = Array.isArray(obj) ? [...(obj as unknown[])] : { ...(obj as object) };
  const walk = (node: unknown): unknown => {
    if (typeof node === "string") return redactText(node);
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (SECRET_KEY_PATTERN.test(k)) {
          out[k] = "[REDACTED]";
        } else {
          out[k] = walk(v);
        }
      }
      return out;
    }
    return node;
  };
  return walk(clone) as T;
}

export function redactConfig<T extends Record<string, unknown>>(obj: T): T {
  const out = { ...(obj as Record<string, unknown>) } as Record<string, unknown>;
  for (const key of ["startCommand", "buildCommand", "host", "publicUrl", "deploymentType", "fixtureId"]) {
    if (typeof out[key] === "string") out[key] = redactText(out[key] as string);
  }
  return out as T;
}
export function containsSecretLike(value: string): boolean {
  if (ASSIGNMENT_PATTERN.test(value)) {
    ASSIGNMENT_PATTERN.lastIndex = 0;
    return true;
  }
  ASSIGNMENT_PATTERN.lastIndex = 0;
  BEARER_PATTERN.lastIndex = 0;
  const found = BEARER_PATTERN.test(value);
  BEARER_PATTERN.lastIndex = 0;
  return found;
}
