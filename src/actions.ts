import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ActionSchema, type Action } from "./schemas.js";

export interface ActionInput {
  caseId: string;
  target: "mock-zendesk" | "mock-linear";
  payload: Record<string, unknown>;
  idempotencyKey: string;
  promptVersion: string;
  sourceDocVersion: string;
}

export interface ActionOptions {
  dataRoot?: string;
  now?: () => string;
  transport?: (action: Action) => Promise<string>;
}

export class ActionConflictError extends Error {
  readonly code = 409;
  constructor(message: string) {
    super(message);
    this.name = "ActionConflictError";
  }
}

export class ActionPayloadMismatchError extends Error {
  readonly code = 422;
  constructor(message: string) {
    super(message);
    this.name = "ActionPayloadMismatchError";
  }
}

const pending = new Set<string>();

function actionsDir(root: string): string {
  return join(root, "actions");
}

function actionPath(root: string, key: string): string {
  return join(actionsDir(root), `${key}.json`);
}

export function hashPayload(payload: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function readAction(root: string, key: string): Promise<Action | null> {
  try {
    const raw = await readFile(actionPath(root, key), "utf8");
    return ActionSchema.parse(JSON.parse(raw));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

const defaultTransport = async (action: Action): Promise<string> => `local-${action.target}-${action.actionId}`;

export async function createMockAction(input: ActionInput, opts: ActionOptions = {}): Promise<Action> {
  const dataRoot = opts.dataRoot ?? ".data";
  const now = opts.now ?? (() => new Date().toISOString());
  const transport = opts.transport ?? defaultTransport;

  if (pending.has(input.idempotencyKey)) {
    throw new ActionConflictError("duplicate request already in flight; retry later (409)");
  }
  pending.add(input.idempotencyKey);

  try {
    const existing = await readAction(dataRoot, input.idempotencyKey);
    const requestHash = hashPayload(input.payload);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new ActionPayloadMismatchError("idempotency key reused with a different payload (422)");
      }
      return existing;
    }
    const createdAt = now();
    const candidate = ActionSchema.parse({
      actionId: `act-${input.idempotencyKey.slice(0, 8)}`,
      caseId: input.caseId,
      target: input.target,
      idempotencyKey: input.idempotencyKey,
      requestHash,
      promptVersion: input.promptVersion,
      sourceDocVersion: input.sourceDocVersion,
      createdAt,
      payload: input.payload,
    });
    const externalId = await transport(candidate);
    const action = ActionSchema.parse({ ...candidate, payload: { ...input.payload, externalId } });
    await mkdir(actionsDir(dataRoot), { recursive: true });
    try {
      await writeFile(actionPath(dataRoot, input.idempotencyKey), JSON.stringify(action, null, 2), {
        flag: "wx",
      });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") {
        const raced = await readAction(dataRoot, input.idempotencyKey);
        if (raced && raced.requestHash === requestHash) return raced;
        throw new ActionPayloadMismatchError("idempotency key reused with a different payload (422)");
      }
      throw e;
    }
    return action;
  } finally {
    pending.delete(input.idempotencyKey);
  }
}
