import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const authMocks = vi.hoisted(() => ({
  createAuthorizedDataContext: vi.fn(),
}));

vi.mock("@/lib/supabase/privileged-server", () => ({
  createAuthorizedDataContext: authMocks.createAuthorizedDataContext,
}));

import { getDocumentImport } from "@/lib/services/document-understanding/service";

describe("document entrypoint authorization ordering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("denies an inactive Admin before reading imports or touching private storage", async () => {
    const profileQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    profileQuery.select.mockReturnValue(profileQuery);
    profileQuery.eq.mockReturnValue(profileQuery);

    const from = vi.fn((table: string) => {
      if (table !== "profiles") {
        throw new Error(`Unexpected service-role read: ${table}`);
      }
      return profileQuery;
    });
    const storageFrom = vi.fn(() => {
      throw new Error("Private storage must not be reached for an inactive Admin");
    });

    authMocks.createAuthorizedDataContext.mockResolvedValue({
      identity: {
        profileId: "10000000-0000-4000-8000-000000000001",
        role: "ADMIN",
      },
      supabase: {
        from,
        storage: { from: storageFrom },
      },
    });

    await expect(getDocumentImport(
      "10000000-0000-4000-8000-000000000099",
    )).rejects.toMatchObject({
      code: "DOCUMENT_PERMISSION_DENIED",
      status: 403,
    });

    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("profiles");
    expect(storageFrom).not.toHaveBeenCalled();
  });
});
