import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ actor: vi.fn(), client: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/auth/server-actor", () => ({ getServerActorContext: mock.actor }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mock.client }));
import { DELETE, GET, POST } from "./route";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const employeeId = "22222222-2222-4222-8222-222222222222";
const preview = { previewId: "33333333-3333-4333-8333-333333333333", role: "TECHNICIAN", effectiveEmployeeProfileId: employeeId, effectiveEmployeeName: "Synthetic Technician", readOnly: true };
const input = { workspaceId, role: "TECHNICIAN", employeeProfileId: employeeId };
const owner = { platformRole: "SUPER_ADMIN", isAnonymous: false, businessReady: true, sessionId: "synthetic-session" };
function request(method = "POST", body: unknown = input, origin = "http://localhost:3200") { return new Request(`http://localhost:3200/api/platform/owner-preview?workspaceId=${workspaceId}`, { method, headers: { origin, "content-type": "application/json" }, ...(method === "POST" ? { body: JSON.stringify(body) } : {}) }); }
beforeEach(() => { vi.resetAllMocks(); mock.actor.mockResolvedValue(owner); mock.client.mockResolvedValue({ rpc: mock.rpc }); mock.rpc.mockImplementation(async (name: string) => ({ data: name === "owner_preview_options" ? { technicians: [{ profileId: employeeId, name: "Synthetic Technician", branchCode: "MOCK" }] } : name === "owner_preview_exit" ? true : preview, error: null })); });
describe("Owner preview authenticated API", () => {
  it("reads verified options and session status with no-store response", async () => {
    const result = await GET(request("GET")); expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toContain("no-store"); expect(await result.json()).toMatchObject({ preview, technicians: [{ profileId: employeeId }] }); expect(mock.rpc.mock.calls).toEqual([["owner_preview_options", { p_workspace_id: workspaceId }], ["owner_preview_status", { p_workspace_id: workspaceId }]]); expect(mock.actor).toHaveBeenCalledWith();
  });
  it("sets only strict role and selected employee arguments using the authenticated client", async () => {
    const result = await POST(request()); expect(result.status).toBe(200); expect(await result.json()).toEqual({ preview }); expect(mock.rpc).toHaveBeenCalledExactlyOnceWith("owner_preview_set", { p_workspace_id: workspaceId, p_role: "TECHNICIAN", p_employee_profile_id: employeeId });
  });
  it.each([{ ...owner, platformRole: "USER" }, { ...owner, isAnonymous: true }, { ...owner, sessionId: null }, { ...owner, businessReady: false }, null])("denies an unverified actual Owner (%j) before RPC", async (actor) => {
    mock.actor.mockResolvedValue(actor); const result = await POST(request()); expect(result.status).toBe(403); expect(mock.rpc).not.toHaveBeenCalled();
  });
  it.each([{ ...input, employeeProfileId: null }, { ...input, role: "MANAGER" }, { ...input, previewId: preview.previewId }, { ...input, role: "SUPER_ADMIN" }, { ...input, workspaceId: "bad" }])("rejects client authority substitution or invalid selection (%j)", async (body) => {
    expect((await POST(request("POST", body))).status).toBe(400); expect(mock.rpc).not.toHaveBeenCalled();
  });
  it.each(["POST", "DELETE"])("rejects cross-origin %s before opening authenticated client", async (method) => {
    const result = await (method === "POST" ? POST : DELETE)(request(method, input, "https://outside.invalid")); expect(result.status).toBe(403); expect(mock.actor).not.toHaveBeenCalled(); expect(mock.client).not.toHaveBeenCalled();
  });
  it("allows explicit exit through the original platform identity even when selected preview is expired", async () => {
    const result = await DELETE(request("DELETE")); expect(result.status).toBe(200); expect(await result.json()).toEqual({ preview: null }); expect(mock.actor).toHaveBeenCalledWith(); expect(mock.rpc).toHaveBeenCalledExactlyOnceWith("owner_preview_exit");
  });
  it("reports invalid/expired status without leaking database messages or restoring Owner", async () => {
    mock.rpc.mockResolvedValueOnce({ data: { technicians: [] }, error: null }).mockResolvedValueOnce({ data: null, error: { message: "synthetic private database detail" } }); const result = await GET(request("GET")); expect(result.status).toBe(409); expect(JSON.stringify(await result.json())).not.toContain("private database");
  });
  it("treats malformed RPC output as unavailable rather than valid preview or client error", async () => {
    mock.rpc.mockResolvedValue({ data: { ...preview, readOnly: false }, error: null }); expect((await POST(request())).status).toBe(503); expect((await GET(request("GET"))).status).toBe(503);
  });
  it("requires bounded valid JSON and does not leak body data in errors", async () => {
    const result = await POST(new Request("http://localhost:3200/api/platform/owner-preview", { method: "POST", headers: { origin: "http://localhost:3200", "content-type": "application/json" }, body: "invalid synthetic JSON" })); expect(result.status).toBe(400); expect(JSON.stringify(await result.json())).not.toContain("synthetic JSON"); expect(mock.rpc).not.toHaveBeenCalled();
  });
});
