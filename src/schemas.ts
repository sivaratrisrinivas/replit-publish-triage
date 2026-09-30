import { z } from "zod";

export const PromptVersion = z.string().min(1);
export const IsoTimestamp = z.string().datetime();

export const TicketSchema = z.object({
  caseId: z.string().min(1),
  ticketText: z.string().min(1),
  reportedAt: IsoTimestamp,
  source: z.enum(["seeded", "pasted"]).default("seeded"),
});
export type Ticket = z.infer<typeof TicketSchema>;

export const ConfigSnapshotSchema = z.object({
  fixtureId: z.string().min(1),
  environment: z.enum(["preview", "published"]),
  deploymentType: z.string().min(1),
  startCommand: z.string().min(1),
  buildCommand: z.string().optional(),
  host: z.string().min(1),
  port: z.number().int().positive(),
  envVarNames: z.array(z.string()),
  secretsPresentNames: z.array(z.string()),
  publicUrl: z.string().optional(),
});
export type ConfigSnapshot = z.infer<typeof ConfigSnapshotSchema>;

export const EvidenceKindSchema = z.enum([
  "customer-reported",
  "supplied-evidence",
  "directly-observed",
  "inferred",
]);
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;

export const EvidenceSchema = z.object({
  evidenceId: z.string().min(1),
  kind: EvidenceKindSchema,
  citation: z.string().min(1),
  content: z.string().min(1),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const ObservationSchema = z.object({
  observationId: z.string().min(1),
  checkName: z.string().min(1),
  startedAt: IsoTimestamp,
  finishedAt: IsoTimestamp,
  outcome: z.enum(["pass", "fail", "incomplete"]),
  detail: z.string().min(1),
  evidenceIds: z.array(z.string()),
});
export type Observation = z.infer<typeof ObservationSchema>;

export const HypothesisSchema = z.object({
  hypothesisId: z.string().min(1),
  category: z.string().min(1),
  rank: z.number().int().positive(),
  evidenceIds: z.array(z.string()).min(1),
  disconfirmingTest: z.string().min(1),
  uncertainty: z.string().min(1),
});
export type Hypothesis = z.infer<typeof HypothesisSchema>;

export const ReviewSchema = z.object({
  caseId: z.string().min(1),
  decision: z.enum(["approve", "reject", "request-changes"]),
  editedReply: z.string(),
  reviewedAt: IsoTimestamp,
  reviewer: z.string().min(1),
});
export type Review = z.infer<typeof ReviewSchema>;

export const ActionSchema = z.object({
  actionId: z.string().min(1),
  caseId: z.string().min(1),
  target: z.enum(["mock-zendesk", "mock-linear"]),
  idempotencyKey: z.string().uuid(),
  requestHash: z.string().min(1),
  promptVersion: PromptVersion,
  sourceDocVersion: z.string().min(1),
  createdAt: IsoTimestamp,
  payload: z.record(z.unknown()),
});
export type Action = z.infer<typeof ActionSchema>;

export const CaseRecordSchema = z.object({
  caseId: z.string().min(1),
  ticket: TicketSchema,
  previewConfig: ConfigSnapshotSchema,
  publishedConfig: ConfigSnapshotSchema,
  createdAt: IsoTimestamp,
});
export type CaseRecord = z.infer<typeof CaseRecordSchema>;
