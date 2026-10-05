import { describe, expect, it, vi } from "vitest";
import type { ActorContext } from "@/lib/auth/actor-policy";
import { readOwnerWorkspaceEntry } from "./owner-entry";

const PROFILE = "11111111-1111-4111-8111-111111111111";
const OWNER = "22222222-2222-4222-8222-222222222222";
const DEMO = "33333333-3333-4333-8333-333333333333";
const actor: ActorContext = { authUserId: PROFILE, profileId: PROFILE, isAnonymous: false, platformRole: "SUPER_ADMIN" };

function client({ memberships = [{ workspace_id: OWNER, role: "ADMIN" }], workspace = { id: OWNER, kind: "OWNER", active: true }, memberError = null, workspaceError = null }: {
  memberships?: { workspace_id: string; role: string }[];
  workspace?: { id: string; kind: string; active: boolean } | null;
  memberError?: string | null; workspaceError?: string | null;
} = {}) {
  function query(result: unknown) {
    const value = Promise.resolve(result);
    const chain = { select: vi.fn(), eq: vi.fn(), in: vi.fn(), maybeSingle: vi.fn(), then: value.then.bind(value) };
    chain.select.mockReturnValue(chain); chain.eq.mockReturnValue(chain); chain.in.mockReturnValue(chain);
    chain.maybeSingle.mockResolvedValue(result);
    return chain;
  }
  const members = query({ data: memberships, error: memberError });
  const workspaces = query({ data: workspace, error: workspaceError });
  const from = vi.fn((table: string) => table === "workspace_memberships" ? members : workspaces);
  return { from, members, workspaces };
}

describe("Owner operational workspace entry", () => {
  it("selects only an active Owner workspace from the verified profile's memberships", async () => {
    const mock = client();
    expect(await readOwnerWorkspaceEntry(actor, mock as never)).toBe(OWNER);
    expect(mock.members.eq).toHaveBeenCalledWith("profile_id", PROFILE);
    expect(mock.members.eq).toHaveBeenCalledWith("active", true);
    expect(mock.workspaces.in).toHaveBeenCalledWith("id", [OWNER]);
    expect(mock.workspaces.eq).toHaveBeenCalledWith("kind", "OWNER");
    expect(mock.workspaces.eq).toHaveBeenCalledWith("active", true);
  });

  it("denies anonymous and non-platform actors before any query", async () => {
    const mock = client();
    expect(await readOwnerWorkspaceEntry({ ...actor, isAnonymous: true }, mock as never)).toBeNull();
    expect(await readOwnerWorkspaceEntry({ ...actor, platformRole: "USER" }, mock as never)).toBeNull();
    expect(mock.from).not.toHaveBeenCalled();
  });

  it("does not substitute an unrelated, Demo, or inactive workspace", async () => {
    for (const workspace of [{ id: DEMO, kind: "OWNER", active: true }, { id: OWNER, kind: "DEMO", active: true }, { id: OWNER, kind: "OWNER", active: false }]) {
      expect(await readOwnerWorkspaceEntry(actor, client({ workspace }) as never)).toBeNull();
    }
    const empty = client({ memberships: [] });
    expect(await readOwnerWorkspaceEntry(actor, empty as never)).toBeNull();
    expect(empty.from).toHaveBeenCalledTimes(1);
  });

  it("reports lookup failures so the page can offer retry", async () => {
    await expect(readOwnerWorkspaceEntry(actor, client({ memberError: "offline" }) as never)).rejects.toThrow("membership unavailable");
    await expect(readOwnerWorkspaceEntry(actor, client({ workspaceError: "offline" }) as never)).rejects.toThrow("workspace unavailable");
  });
});
