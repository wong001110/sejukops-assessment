import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { staffAccountInputSchema, type StaffImportDraft, type StaffImportPreview, type StaffImportResult } from "@/domain/staff/contracts";
import type { PlatformDataContext } from "@/lib/supabase/platform-server";
import { createStaffAccount, listStaffAccounts, StaffAccountError, staffOwnerParameters, staffRpc } from "./service";

const rowSchema = z.object({ row: z.number().int().min(2).max(1001),input: staffAccountInputSchema.nullable(),errors: z.array(z.string().max(300)) }).strict();
const draftSchema = z.object({ importId: z.string().uuid(),expiresAt: z.string().datetime({ offset: true }),
  rows: z.array(rowSchema).max(100),validCount: z.number().int(),invalidCount: z.number().int() }).strict();
const claimSchema = z.object({ claimToken: z.string().uuid(),rows: z.array(z.object({ row: z.number().int(),
  requestKey: z.string().uuid(),input: staffAccountInputSchema }).strict()).max(10) }).strict();
const resultSchema = z.object({ complete: z.boolean(),results: z.array(z.object({ row: z.number().int(),
  status: z.enum(["CREATED","ALREADY_CREATED","FAILED"]),profileId: z.string().uuid().optional(),error: z.string().max(300).optional() }).strict()).max(100) }).strict();

export async function previewStaffImport(context: PlatformDataContext,workspaceId: string,preview: StaffImportPreview): Promise<StaffImportDraft> {
  // Even invalid workbooks need a fresh Owner/workspace authorization before any preview.
  await listStaffAccounts(context,workspaceId);
  const rows = z.array(rowSchema).min(1).max(100).parse(preview.rows);
  const invalidCount = rows.filter(row => row.input === null || row.errors.length > 0).length;
  if (invalidCount) return { importId: randomUUID(),expiresAt: new Date(Date.now()+30*60_000).toISOString(),
    rows,validCount: rows.length-invalidCount,invalidCount };
  return draftSchema.parse(await staffRpc(context.supabase,"staff_preview_import",{
    ...staffOwnerParameters(context.actor,workspaceId),p_rows: rows.map(({row,input})=>({row,input})),
  }));
}

/** Each response is one bounded batch; credentials never enter persisted results. */
export async function confirmStaffImport(context: PlatformDataContext,workspaceId: string,importId: string,retryFailed = false): Promise<{results: StaffImportResult[];complete: boolean}> {
  z.string().uuid().parse(importId);
  const owner = staffOwnerParameters(context.actor,workspaceId);
  const claim = claimSchema.parse(await staffRpc(context.supabase,"staff_claim_import",{
    ...owner,p_import_id: importId,p_retry_failed: retryFailed,
  }));
  const results: Array<{row: number;status: "CREATED"|"ALREADY_CREATED"|"FAILED";profileId?: string;errorCode?: string}> = [];
  const credentials = new Map<number,NonNullable<StaffImportResult["credential"]>>();
  const unavailableCredentials = new Set<number>();
  for (const row of claim.rows) {
    try {
      const created = await createStaffAccount(context,workspaceId,row.requestKey,row.input);
      results.push({ row: row.row,status: created.status,profileId: created.account.profileId });
      if (created.credential) credentials.set(row.row,created.credential);
      else unavailableCredentials.add(row.row);
    } catch (error) {
      // Never persist exception text, input credentials or arbitrary provider errors.
      const code = error instanceof StaffAccountError && ["STAFF_CONFLICT","STAFF_INVALID_INPUT"].includes(error.code)
        ? error.code : "STAFF_UNAVAILABLE";
      results.push({ row: row.row,status: "FAILED",errorCode: code });
    }
  }
  try {
    const finished = resultSchema.parse(await staffRpc(context.supabase,"staff_finish_import_batch",{
      ...owner,p_import_id: importId,p_claim_token: claim.claimToken,p_results: results,
    }));
    return { ...finished,results: finished.results.map(row=>({ ...row,
      ...(unavailableCredentials.has(row.row) ? {error:"Account created; its temporary password is unavailable. Use Reset temporary password to deliver a new one."} : {}),
      ...(credentials.has(row.row) ? {credential: credentials.get(row.row)} : {}),
    })) };
  } finally { credentials.clear(); unavailableCredentials.clear(); }
}
