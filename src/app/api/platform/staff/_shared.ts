import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { StaffAccountError } from "@/lib/services/staff-accounts/service";
import { PlatformPermissionDeniedError, createPlatformDataContext } from "@/lib/supabase/platform-server";

export async function staffApiContext() {
  const context = await createPlatformDataContext("ai_config:manage");
  if (!context.actor.sessionId) throw new StaffAccountError("STAFF_OWNER_REQUIRED",403,"Sign in again to manage staff.");
  return context;
}

export function requireStaffOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    throw new StaffAccountError("STAFF_FORBIDDEN",403,"The request origin is unavailable.");
  }
}

export async function readStaffJson(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new StaffAccountError("STAFF_INVALID_INPUT",400,"Send a JSON account request.");
  }
  const bytes = await readStaffBody(request,16_384);
  try { return JSON.parse(new TextDecoder("utf-8",{ fatal: true }).decode(bytes)); }
  catch { throw new StaffAccountError("STAFF_INVALID_INPUT",400,"Check the account fields."); }
}

export async function readStaffBody(request: Request,maxBytes: number): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) throw new StaffAccountError("STAFF_INVALID_INPUT",400,"Enter account fields.");
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new StaffAccountError("STAFF_PAYLOAD_TOO_LARGE",413,"The account request is too large.");
      }
      parts.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) { bytes.set(part,offset); offset += part.byteLength; }
    return bytes;
  } finally { reader.releaseLock(); }
}

export function staffResponse(body: unknown,status = 200) {
  return NextResponse.json(body,{ status,headers: { "Cache-Control": "no-store, private",Vary: "Cookie" } });
}
export function staffApiError(error: unknown) {
  if (error instanceof StaffAccountError) return staffResponse({ error: { code: error.code,message: error.message } },error.status);
  if (error instanceof PlatformPermissionDeniedError) return staffResponse({ error: { code: "STAFF_FORBIDDEN",message: "An authenticated Owner is required." } },403);
  if (error instanceof ZodError) return staffResponse({ error: { code: "STAFF_INVALID_INPUT",message: "Check the account fields and current revision." } },400);
  return staffResponse({ error: { code: "STAFF_UNAVAILABLE",message: "Account management is unavailable. Retry later." } },503);
}
