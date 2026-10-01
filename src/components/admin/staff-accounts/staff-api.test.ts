import { afterEach, describe, expect, it, vi } from "vitest";
import type { StaffAccountSummary } from "@/domain/staff/contracts";
import { StaffApiError, staffApi } from "./staff-api";

const account: StaffAccountSummary = { profileId: "synthetic-profile", name: "Synthetic Staff", email: "staff@example.invalid", role: "ADMIN", branchCode: null, active: true, passwordChangeRequired: false, authRevision: "observed-revision" };
afterEach(() => vi.unstubAllGlobals());
describe("staff browser adapter", () => {
  it("uses no-store for list, create, revision updates and password resets", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ accounts: [], branches: [], account, credential: null }), { status: 200 })); vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    await staffApi.list("workspace & id", controller.signal);
    await staffApi.create("workspace", "request-key", { name: account.name, email: account.email, role: "ADMIN", branchCode: null });
    await staffApi.update("workspace", account, { role: "MANAGER", branchCode: null, active: false });
    await staffApi.resetPassword("workspace", account, "reset-key");
    for (const [, init] of fetchMock.mock.calls) expect(init.cache).toBe("no-store");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/platform/staff?workspaceId=workspace%20%26%20id");
    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ workspaceId: "workspace", expectedRevision: "observed-revision", role: "MANAGER", branchCode: null, active: false });
    expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toEqual({ workspaceId: "workspace", expectedRevision: "observed-revision", requestKey: "reset-key" });
  });
  it("leaves multipart boundaries to fetch and sends only explicit retryFailed", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ results: [], complete: true }), { status: 200 })); vi.stubGlobal("fetch", fetchMock);
    await staffApi.preview("workspace", new File(["synthetic"], "staff.xlsx"));
    const init = fetchMock.mock.calls[0][1]; expect(init.cache).toBe("no-store"); expect(init.headers).toBeUndefined(); expect(init.body.get("workspaceId")).toBe("workspace"); expect(init.body.get("file").name).toBe("staff.xlsx");
    await staffApi.confirm("workspace", "import"); await staffApi.confirm("workspace", "import", true);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ workspaceId: "workspace", importId: "import" });
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ workspaceId: "workspace", importId: "import", retryFailed: true });
  });
  it("returns only the safe error envelope and rejects malformed success", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "STAFF_STALE", message: "Refresh the employee before retrying." }, internal: "must not surface" }), { status: 409 })).mockResolvedValueOnce(new Response("not json", { status: 200 })); vi.stubGlobal("fetch", fetchMock);
    await expect(staffApi.list("workspace")).rejects.toEqual(new StaffApiError("Refresh the employee before retrying.", "STAFF_STALE", 409));
    await expect(staffApi.list("workspace")).rejects.toThrow("The staff response was incomplete. Please retry.");
  });
});
