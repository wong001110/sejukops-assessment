import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const authMocks = vi.hoisted(() => ({
  createAuthorizedDataContext: vi.fn(),
}));

vi.mock("@/lib/supabase/privileged-server", () => ({
  createAuthorizedDataContext: authMocks.createAuthorizedDataContext,
}));

import { createAdminOrder } from "@/lib/services/admin-orders/service";

describe("Admin order entrypoint authorization ordering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("denies an inactive stale-cookie Admin before RPC or order/customer hydration", async () => {
    const profileQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    profileQuery.select.mockReturnValue(profileQuery);
    profileQuery.eq.mockReturnValue(profileQuery);

    const from = vi.fn((table: string) => {
      if (table !== "profiles") {
        throw new Error(`Unexpected service-role hydration: ${table}`);
      }
      return profileQuery;
    });
    const rpc = vi.fn(() => {
      throw new Error("RPC must not run for an inactive Admin");
    });

    authMocks.createAuthorizedDataContext.mockResolvedValue({
      identity: {
        profileId: "10000000-0000-4000-8000-000000000001",
        role: "ADMIN",
      },
      supabase: { from, rpc },
    });

    await expect(createAdminOrder({
      customer: {
        name: "Fictional Customer",
        phone: "+601100000099",
        address: "99 Jalan Fiksyen, Kuala Lumpur",
      },
      branchId: "00000000-0000-4000-8000-000000000101",
      problemDescription: "Rollback-free authorization regression",
      serviceType: "Inspection",
      quotedPrice: 88,
      requestKey: "10000000-0000-4000-8000-000000000099",
    })).rejects.toMatchObject({
      code: "ADMIN_ORDER_PERMISSION_DENIED",
      status: 403,
    });

    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("profiles");
    expect(profileQuery.eq.mock.calls).toEqual([
      ["id", "10000000-0000-4000-8000-000000000001"],
      ["role", "ADMIN"],
      ["active", true],
    ]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed when deactivation races the profile check and RPC", async () => {
    const profileQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: "10000000-0000-4000-8000-000000000001" },
        error: null,
      }),
    };
    profileQuery.select.mockReturnValue(profileQuery);
    profileQuery.eq.mockReturnValue(profileQuery);

    const from = vi.fn((table: string) => {
      if (table !== "profiles") {
        throw new Error(`Unexpected post-RPC hydration: ${table}`);
      }
      return profileQuery;
    });
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "INVALID_ADMIN_ACTOR", code: "P0001" },
    });

    authMocks.createAuthorizedDataContext.mockResolvedValue({
      identity: {
        profileId: "10000000-0000-4000-8000-000000000001",
        role: "ADMIN",
      },
      supabase: { from, rpc },
    });

    await expect(createAdminOrder({
      customer: {
        name: "Fictional Customer",
        phone: "+601100000099",
        address: "99 Jalan Fiksyen, Kuala Lumpur",
      },
      branchId: "00000000-0000-4000-8000-000000000101",
      problemDescription: "Authorization race regression",
      serviceType: "Inspection",
      quotedPrice: 88,
      requestKey: "10000000-0000-4000-8000-000000000098",
    })).rejects.toMatchObject({
      code: "ADMIN_ORDER_PERMISSION_DENIED",
      status: 403,
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledTimes(1);
  });
});
