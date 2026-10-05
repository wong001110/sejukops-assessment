import { describe, expect, it, vi } from "vitest";

import type { ActorContext } from "@/lib/auth/actor-policy";

import { readWorkspaceGeneration, WorkspaceGenerationError } from "./generation";

const DEMO = "11111111-1111-4111-8111-111111111111";
const OWNER = "22222222-2222-4222-8222-222222222222";

function actor(workspaceId: string, kind: "DEMO" | "OWNER", isAnonymous = false) {
  return { isAnonymous, membership: { workspaceId, kind } } as ActorContext;
}

function client(generation = 2) {
  const single = vi.fn().mockResolvedValue({ data: { generation }, error: null });
  const eq = vi.fn().mockReturnValue({ single });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  return { from, select, eq, single };
}

describe("workspace generation read", () => {
  it("reads only the server actor's workspace through the caller client", async () => {
    const mock = client();
    expect(await readWorkspaceGeneration(actor(DEMO, "DEMO", true), mock as never, DEMO)).toBe(2);
    expect(mock.from).toHaveBeenCalledWith("workspaces");
    expect(mock.eq).toHaveBeenCalledWith("id", DEMO);
  });

  it("rejects cross-workspace and anonymous Owner reads before querying", async () => {
    const mock = client();
    await expect(readWorkspaceGeneration(actor(DEMO, "DEMO"), mock as never, OWNER))
      .rejects.toMatchObject({ code: "FORBIDDEN" } satisfies Partial<WorkspaceGenerationError>);
    await expect(readWorkspaceGeneration(actor(OWNER, "OWNER", true), mock as never, OWNER))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mock.from).not.toHaveBeenCalled();
  });

  it("fails closed when the RLS row is missing", async () => {
    const mock = client();
    mock.single.mockResolvedValue({ data: null, error: null });
    await expect(readWorkspaceGeneration(actor(DEMO, "DEMO"), mock as never, DEMO))
      .rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
});
