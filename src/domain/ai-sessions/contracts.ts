import { z } from "zod";
import { nativeActivitySchema, nativeWorkspaceSchema } from "@/domain/agent-workspace/contracts";

export const aiSessionSurfaceSchema = z.enum(["CHATBOT", "WORKSPACE"]);
export const AI_SESSION_HEADER = "X-Sejuk-Session";
export const aiSessionSummarySchema = z.object({
  id: z.string().uuid(), workspaceId: z.string().uuid(), workspaceKind: z.enum(["DEMO", "OWNER"]),
  title: z.string().max(100), surface: aiSessionSurfaceSchema, role: z.enum(["ADMIN", "MANAGER", "TECHNICIAN"]),
  createdAt: z.string().datetime({ offset: true }), updatedAt: z.string().datetime({ offset: true }), turnCount: z.number().int().min(0).max(50),
}).strict();
export const aiSessionTurnSchema = z.object({
  id: z.string().uuid(), question: z.string().max(1000), status: z.enum(["RUNNING", "COMPLETED", "FAILED", "INTERRUPTED"]),
  answer: z.string().max(6000).nullable(), createdAt: z.string().datetime({ offset: true }), completedAt: z.string().datetime({ offset: true }).nullable(),
  workspace: nativeWorkspaceSchema.nullable(), activity: z.array(nativeActivitySchema).max(12),
}).strict();
export const aiSessionListResponseSchema = z.object({
  sessions: z.array(aiSessionSummarySchema).max(30), nextCursor: z.string().uuid().nullable(),
  workspaces: z.array(z.object({ id: z.string().uuid(), kind: z.enum(["DEMO", "OWNER"]), name: z.string() }).strict()).max(2),
}).strict();
export const aiSessionDetailResponseSchema = z.object({ session: aiSessionSummarySchema, turns: z.array(aiSessionTurnSchema).max(50) }).strict();
export type AiSessionSummary = z.infer<typeof aiSessionSummarySchema>;
export type AiSessionTurn = z.infer<typeof aiSessionTurnSchema>;
export type AiSessionSurface = z.infer<typeof aiSessionSurfaceSchema>;

/** Correlation only. Identity and scope always come from the server. */
export function readAiSessionId(request: Request): string | undefined {
  const value = request.headers.get(AI_SESSION_HEADER);
  if (value === null) return undefined;
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) throw new Error("Invalid conversation identifier");
  return parsed.data;
}
