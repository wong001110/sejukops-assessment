import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createPlatformDataContext: vi.fn(),
  insert: vi.fn(async () => ({ error: null })),
  deleteOld: vi.fn(async () => ({ error: null })),
}));

vi.mock("@/lib/supabase/platform-server", () => ({
  createPlatformDataContext: mocks.createPlatformDataContext,
}));

import { persistAIObservation } from "./ai-observation-store";

const supabase = {
  from: () => ({
    insert: mocks.insert,
    delete: () => ({ eq: () => ({ lt: mocks.deleteOld }) }),
  }),
};
const input = {
  traceId: "00000000-0000-4000-8000-000000000041",
  task: "PROVIDER_TEST" as const,
  ok: true,
  value: { ok: true },
  responseStatus: 200,
  durationMs: 3,
  exchanges: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createPlatformDataContext.mockResolvedValue({
    actor: { profileId: "00000000-0000-4000-8000-000000000011" },
    supabase,
  });
});

describe("provider test observation authority", () => {
  it("persists a platform Super Admin trace without a Demo cookie", async () => {
    await persistAIObservation(input);

    expect(mocks.createPlatformDataContext).toHaveBeenCalledWith("diagnostics:view");
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      actor_profile_id: "00000000-0000-4000-8000-000000000011",
      metadata_json: expect.objectContaining({ actorRole: "SUPER_ADMIN" }),
    }));
  });

  it("does not fall back to Demo authority when the platform gate rejects", async () => {
    mocks.createPlatformDataContext.mockRejectedValue(new Error("denied"));
    await persistAIObservation(input);

    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
