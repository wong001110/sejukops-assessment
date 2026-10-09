import { z } from "zod";

export const nativeAgentRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(1_000),
  contextOrderIds: z.array(z.string().uuid()).max(4).default([]),
  conversation: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(700),
  }).strict()).max(6).default([]),
}).strict();

export const nativeViewTypeSchema = z.enum(["focus", "investigation", "comparison", "knowledge", "clarification"]);

/** Untrusted layout choices. The server resolves every reference from this run's reads. */
export const nativeViewPlanSchema = z.object({
  type: nativeViewTypeSchema,
  title: z.string().trim().min(1).max(100),
  summary: z.string().trim().max(700),
  items: z.array(z.object({
    orderId: z.string().uuid(),
    interpretation: z.string().trim().max(350),
  }).strict()).max(5),
  excerpts: z.array(z.object({
    index: z.number().int().min(0).max(7),
    text: z.string().min(1).max(500),
  }).strict()).max(3),
  proposalId: z.string().uuid().nullable(),
  missingInformation: z.array(z.string().trim().min(1).max(240)).max(4),
  followUps: z.array(z.string().trim().min(1).max(200)).max(3),
}).strict();

const sourceOrderSchema = z.object({
  id: z.string().uuid(),
  order_no: z.string().max(120),
  branch_id: z.string().uuid(),
  status: z.string().max(40),
  problem_description: z.string().max(8_000),
  service_type: z.string().max(500),
  scheduled_at: z.string().nullable(),
  assigned_technician_id: z.string().uuid().nullable(),
  updated_at: z.string(),
}).strict();

const nativeCitationSchema = z.object({
  workspaceId: z.string().uuid(),
  documentId: z.string().uuid(),
  versionId: z.string().uuid(),
  title: z.string().max(300),
  sourceLabel: z.string().max(300),
  section: z.string().max(300),
  page: z.number().int().min(1),
  ordinal: z.number().int().min(0),
}).strict();

export const nativeProposalSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["PENDING", "APPROVED", "EXECUTED", "STALE", "EXPIRED"]),
  canonicalPayload: z.object({
    orderId: z.string().uuid(),
    technicianId: z.string().uuid(),
    scheduledAt: z.string().nullable(),
  }).strict(),
  targetUpdatedAt: z.string(),
  expiresAt: z.string(),
  orderNo: z.string(),
  technicianLabel: z.string(),
}).strict();

/** Public hydrated data only: no arbitrary components, HTML, URLs, styles or code. */
export const nativeWorkspaceSchema = z.object({
  runId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  mode: z.enum(["live", "mock"]),
  type: nativeViewTypeSchema,
  title: z.string().min(1).max(100),
  summary: z.string().max(700),
  status: z.enum(["COMPLETE", "SOURCE_ONLY"]),
  items: z.array(z.object({ order: sourceOrderSchema, interpretation: z.string().max(350) }).strict()).max(5),
  excerpts: z.array(z.object({ text: z.string().max(500), citation: nativeCitationSchema }).strict()).max(3),
  proposal: nativeProposalSchema.nullable(),
  missingInformation: z.array(z.string().max(240)).max(4),
  followUps: z.array(z.string().max(200)).max(3),
  scope: z.object({
    ordersRead: z.number().int().min(0).max(50),
    knowledgeHits: z.number().int().min(0).max(8),
    checkedAt: z.string(),
  }).strict(),
}).strict().superRefine((workspace, ctx) => {
  const orderIds = workspace.items.map(({ order }) => order.id);
  if (new Set(orderIds).size !== orderIds.length ||
      workspace.type === "investigation" && orderIds.length !== 1 ||
      workspace.type === "comparison" && (orderIds.length < 2 || orderIds.length > 4)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid record references for this view" });
  }
  if (workspace.excerpts.some(({ citation }) => citation.workspaceId !== workspace.workspaceId) ||
      new Set(workspace.excerpts.map(({ citation }) => `${citation.versionId}:${citation.ordinal}`)).size !== workspace.excerpts.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid source references for this workspace" });
  }
  if (workspace.proposal && !orderIds.includes(workspace.proposal.canonicalPayload.orderId)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "The proposal target must be displayed" });
  }
});

export const nativeActivitySchema = z.object({
  id: z.string().uuid(),
  tool: z.enum(["recentOrders", "readOrder", "searchKnowledge", "listTechnicians", "prepareAssignment"]),
  status: z.enum(["running", "succeeded", "failed"]),
  count: z.number().int().min(0).max(100).optional(),
}).strict();

export const nativeAgentEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("started"), runId: z.string().uuid() }).strict(),
  z.object({ type: z.literal("activity"), activity: nativeActivitySchema }).strict(),
  z.object({ type: z.literal("workspace"), workspace: nativeWorkspaceSchema, historySaved: z.boolean().optional() }).strict(),
  z.object({ type: z.literal("error"), message: z.string().max(500), code: z.string().max(80), resetAt: z.string().nullable().optional() }).strict(),
]);

export type NativeAgentRequest = z.infer<typeof nativeAgentRequestSchema>;
export type NativeViewPlan = z.infer<typeof nativeViewPlanSchema>;
export type NativeWorkspace = z.infer<typeof nativeWorkspaceSchema>;
export type NativeActivity = z.infer<typeof nativeActivitySchema>;
export type NativeAgentEvent = z.infer<typeof nativeAgentEventSchema>;
export type NativeProposal = z.infer<typeof nativeProposalSchema>;
