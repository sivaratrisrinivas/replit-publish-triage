import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ReviewSchema, type Review } from "./schemas.js";
import { createMockAction } from "./actions.js";
import type { DiagnoseOutput } from "./diagnose.js";
import { redactText } from "./redact.js";

export interface PacketCaseData {
  caseId: string;
  ticketText: string;
  environment: string;
  evidenceRefs: string[];
}

export interface HandoffPacket {
  reply: string;
  reproSteps: string[];
  expected: string;
  actual: string;
  environment: string;
  evidenceRefs: string[];
  openQuestions: string[];
  suggestedOwner: string;
  rootCauseClaim: string | null;
}

export function buildPacket(input: { caseData: PacketCaseData; diagnosis: DiagnoseOutput }): HandoffPacket {
  const { caseData, diagnosis } = input;
  const top = diagnosis.hypotheses[0];
  const openQuestions = [
    ...diagnosis.unknowns,
    ...diagnosis.conflicts,
    ...(diagnosis.abstention ? [diagnosis.abstention] : []),
  ];
  const reproSteps = [
    "1. Load the seeded Preview fixture and confirm it responds.",
    "2. Load the published fixture snapshot and compare configuration.",
    "3. Run the approved allowlisted checks (at most three) and capture observations.",
  ];
  const suggestedOwner = top ? "support-triage (evidence-backed)" : "support-intake (evidence request)";
  const rootCauseClaim = diagnosis.definitive && top ? top.category : null;
  const lines = [
    `Case ${caseData.caseId}: ${top ? `suspected ${top.category}` : "no publishing defect established"}.`,
    `Evidence: ${caseData.evidenceRefs.join(", ")}.`,
    top ? `Disconfirming test: ${top.disconfirmingTest}` : "Ask for the missing evidence before diagnosing.",
    `Open questions: ${openQuestions.join("; ") || "none"}.`,
  ];
  return {
    reply: lines.join(" "),
    reproSteps,
    expected: "preview works",
    actual: caseData.ticketText.slice(0, 280),
    environment: caseData.environment,
    evidenceRefs: [...caseData.evidenceRefs],
    openQuestions,
    suggestedOwner,
    rootCauseClaim,
  };
}

export interface ApproveInput {
  caseId: string;
  reviewer: string;
  editedReply: string;
  target: "mock-zendesk" | "mock-linear";
  idempotencyKey: string;
  caseData: PacketCaseData;
  diagnosis: DiagnoseOutput;
}

export interface ReviewOptions {
  dataRoot?: string;
  now?: () => string;
}

async function saveReview(review: Review, root: string): Promise<void> {
  await mkdir(join(root, "reviews"), { recursive: true });
  await writeFile(join(root, "reviews", `${review.caseId}.json`), JSON.stringify(review, null, 2));
}

export async function approveReview(input: ApproveInput, opts: ReviewOptions = {}) {
  const dataRoot = opts.dataRoot ?? ".data";
  const now = opts.now ?? (() => new Date().toISOString());
  const packet = buildPacket({ caseData: input.caseData, diagnosis: input.diagnosis });
  const review = ReviewSchema.parse({
    caseId: input.caseId,
    decision: "approve",
    editedReply: input.editedReply,
    reviewedAt: now(),
    reviewer: input.reviewer,
  });
  const action = await createMockAction(
    {
      caseId: input.caseId,
      target: input.target,
      payload: {
        reply: input.editedReply,
        evidenceRefs: packet.evidenceRefs,
        reproSteps: packet.reproSteps,
        rootCauseClaim: packet.rootCauseClaim,
      },
      idempotencyKey: input.idempotencyKey,
      promptVersion: "v1",
      sourceDocVersion: "docs-2026-09-30",
    },
    { dataRoot },
  );
  await saveReview(review, dataRoot);
  return { review, action, packet };
}

export async function rejectReview(
  input: { caseId: string; reviewer: string; editedReply: string },
  opts: ReviewOptions = {},
) {
  const dataRoot = opts.dataRoot ?? ".data";
  const now = opts.now ?? (() => new Date().toISOString());
  const review = ReviewSchema.parse({
    caseId: input.caseId,
    decision: "reject",
    editedReply: input.editedReply,
    reviewedAt: now(),
    reviewer: input.reviewer,
  });
  await saveReview(review, dataRoot);
  return { review };
}

export function exportCaseMarkdown(input: { caseData: PacketCaseData; diagnosis: DiagnoseOutput }): string {
  const packet = buildPacket(input);
  const safe = (s: string) => redactText(s);
  return [
    `# Case ${safe(input.caseData.caseId)} (SYNTHETIC)`,
    ``,
    `## Reported`,
    safe(input.caseData.ticketText),
    ``,
    `## Packet`,
    safe(packet.reply),
    ``,
    `## Evidence refs`,
    ...packet.evidenceRefs.map((r) => `- ${safe(r)}`),
    ``,
    `## Open questions`,
    ...packet.openQuestions.map((q) => `- ${safe(q)}`),
  ].join("\n");
}
