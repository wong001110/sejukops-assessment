import { delay, HttpResponse } from "msw";
import { staffAccountInputSchema, type StaffImportDraft, type StaffImportResult, type StaffRowResult } from "../../src/domain/staff/contracts";
import { mockStaffAccount, mockStaffImportRows, staffFixture } from "../fixtures/ui/staff";

function initialStaffStore() { return { accounts: structuredClone(staffFixture.accounts).map((account) => ({ ...account })), keys: new Map<string, string>(), imports: new Map<string, { draft: StaffImportDraft; results: StaffRowResult[] }>(), sequence: 10, confirmations: 0, previewFailures: 0, importFailures: 0 }; }
let store = initialStaffStore();
export function resetStaffMock(empty = false) { store = initialStaffStore(); if (empty) store.accounts = []; }
const failure = (message: string, status = 400) => HttpResponse.json({ error: { code: "MOCK_STAFF_ERROR", message } }, { status });
// Synthetic temporary passwords are returned only in the credential envelope, never notices or stored results.
const mockCredential = (email: string) => ({ email, password: "SYNTHETIC-ONLY-Temporary-42" });

export async function resolveStaffMock(request: Request, selected: string): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/platform/staff")) return undefined;
  const state = store;
  const path = url.pathname;
  const method = request.method;
  if (selected === "delayed") await delay(6000);
  if (request.signal.aborted) return failure("MOCK staff request cancelled", 499);
  if (selected === "server-error") return failure("MOCK staff service unavailable. Select success and retry.", 503);
  if (path === "/api/platform/staff" && method === "GET") return HttpResponse.json({ accounts: state.accounts, branches: staffFixture.branches });
  if (path === "/api/platform/staff/import/template" && method === "GET") {
    // Test file only: this browser harness does not exercise XLSX serialization/parsing.
    return new HttpResponse("SYNTHETIC MOCK XLSX TEMPLATE", { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": 'attachment; filename="mock-staff-template.xlsx"', "Cache-Control": "no-store" } });
  }
  if (path === "/api/platform/staff/import/preview" && method === "POST") {
    const form = await request.formData(); const file = form.get("file");
    if (!(file instanceof File) || !form.get("workspaceId")) return failure("MOCK workbook missing.");
    if (selected === "staff-preview-retry" && state.previewFailures++ === 0) return failure("MOCK validation temporarily unavailable. Retry validation.", 503);
    const invalid = file.name === "invalid.xlsx";
    const rows = invalid ? [{ row: 2, input: null, errors: ["Technicians need a branch code."] }] : mockStaffImportRows(selected === "staff-slow-import" ? 12 : 2);
    const draft: StaffImportDraft = { importId: `mock-import-${++state.sequence}`, expiresAt: "2099-10-01T00:00:00Z", rows, validCount: invalid ? 0 : rows.length, invalidCount: invalid ? 1 : 0 };
    state.imports.set(draft.importId, { draft, results: [] }); return HttpResponse.json(draft);
  }
  const body = ["POST", "PATCH"].includes(method) ? await request.json() as Record<string, unknown> : {};
  if (selected === "validation" && ["POST", "PATCH"].includes(method)) return failure("MOCK validation rejected this input.");
  if (path === "/api/platform/staff" && method === "POST") {
    // Keep the visible pending state deterministic for a real browser double click.
    await delay(500);
    const parsed = staffAccountInputSchema.safeParse(body.input);
    if (!parsed.success || typeof body.requestKey !== "string" || !body.workspaceId) return failure("MOCK invalid staff input.");
    const existingId = state.keys.get(body.requestKey);
    if (existingId) return HttpResponse.json({ status: "ALREADY_CREATED", account: state.accounts.find((account) => account.profileId === existingId), credential: null });
    if (state.accounts.some((account) => account.email === parsed.data.email)) return failure("MOCK employee email already exists.", 409);
    const account = mockStaffAccount(parsed.data, ++state.sequence); state.accounts.push(account); state.keys.set(body.requestKey, account.profileId);
    return HttpResponse.json({ status: "CREATED", account, credential: mockCredential(account.email) });
  }
  if (path === "/api/platform/staff/import/confirm" && method === "POST") {
    state.confirmations++;
    if (selected === "staff-slow-import") await delay(5000);
    if (selected === "staff-import-retry" && state.importFailures++ === 0) return failure("MOCK batch temporarily unavailable. Resume import.", 503);
    const entry = state.imports.get(String(body.importId));
    if (!entry || entry.draft.invalidCount) return failure("MOCK invalid import preview.");
    if (body.retryFailed === true) entry.results = entry.results.filter((result) => result.status !== "FAILED");
    const remaining = entry.draft.rows.filter((row) => !entry.results.some((result) => result.row === row.row));
    const batch = remaining.slice(0, selected === "staff-partial" ? 1 : 10);
    const results: StaffImportResult[] = [];
    for (const row of batch) {
      const fail = selected === "staff-partial" && row.row === 3 && body.retryFailed !== true;
      if (fail || !row.input) { const result = { row: row.row, status: "FAILED" as const, error: "MOCK identity service temporarily unavailable." }; entry.results.push(result); results.push(result); continue; }
      const existing = state.accounts.find((account) => account.email === row.input?.email);
      const account = existing ?? mockStaffAccount(row.input, ++state.sequence); if (!existing) state.accounts.push(account);
      const result: StaffRowResult = { row: row.row, status: existing ? "ALREADY_CREATED" : "CREATED", profileId: account.profileId }; entry.results.push(result);
      results.push({ ...result, ...(!existing ? { credential: mockCredential(account.email) } : {}) });
    }
    return HttpResponse.json({ results, complete: entry.results.length === entry.draft.rows.length });
  }
  const accountRoute = /^\/api\/platform\/staff\/([^/]+)(\/password)?$/.exec(path);
  if (accountRoute) {
    const account = state.accounts.find((item) => item.profileId === accountRoute[1]);
    if (!account) return failure("MOCK account unavailable.", 404);
    if (body.expectedRevision !== account.authRevision || selected === "stale-write") return failure("MOCK account changed. Refresh before retrying.", 409);
    if (method === "PATCH" && !accountRoute[2]) {
      const parsed = staffAccountInputSchema.safeParse({ name: account.name, email: account.email, role: body.role, branchCode: body.branchCode });
      if (!parsed.success || typeof body.active !== "boolean") return failure("MOCK role/branch invalid.");
      Object.assign(account, parsed.data, { active: body.active, authRevision: `mock-revision-${++state.sequence}` }); return HttpResponse.json({ account });
    }
    if (method === "POST" && accountRoute[2]) {
      account.passwordChangeRequired = true; account.authRevision = `mock-revision-${++state.sequence}`;
      return HttpResponse.json({ status: "RESET", account, credential: mockCredential(account.email) });
    }
  }
  return failure(`Missing MOCK staff handler: ${method} ${path}`, 500);
}
