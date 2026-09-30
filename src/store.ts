import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { join } from "node:path";

export interface CaseEvent {
  seq: number;
  type: string;
  caseId: string;
  at: string;
  data: Record<string, unknown>;
}

function casesDir(root: string): string {
  return join(root, "cases");
}

function eventsPath(root: string, caseId: string): string {
  return join(root, "events", `${caseId}.ndjson`);
}

export async function saveCase(caseId: string, record: unknown, root = ".data"): Promise<void> {
  await mkdir(casesDir(root), { recursive: true });
  await writeFile(join(casesDir(root), `${caseId}.json`), JSON.stringify(record, null, 2), "utf8");
}

export async function loadCase<T = unknown>(caseId: string, root = ".data"): Promise<T> {
  const raw = await readFile(join(casesDir(root), `${caseId}.json`), "utf8");
  return JSON.parse(raw) as T;
}

export async function appendEvent(root: string, event: Omit<CaseEvent, "seq">): Promise<CaseEvent> {
  await mkdir(join(root, "events"), { recursive: true });
  const path = eventsPath(root, event.caseId);
  let seq = 1;
  try {
    const raw = await readFile(path, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    seq = lines.length + 1;
  } catch {
    seq = 1;
  }
  const full: CaseEvent = { ...event, seq };
  await appendFile(path, JSON.stringify(full) + "\n", "utf8");
  return full;
}

export async function loadEvents(caseId: string, root = ".data"): Promise<CaseEvent[]> {
  try {
    const raw = await readFile(eventsPath(root, caseId), "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as CaseEvent);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}
