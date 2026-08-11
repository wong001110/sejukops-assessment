import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { SupabaseClient } from "@supabase/supabase-js";

import { requireActiveDocumentAdmin } from "@/lib/services/document-understanding/service";

function profileClient(result: Readonly<{ data: unknown; error: { message: string } | null }>) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  const from = vi.fn().mockReturnValue(chain);
  return {
    client: { from } as unknown as SupabaseClient,
    from,
    chain,
  };
}

describe("active Admin document privacy boundary", () => {
  it("allows only a matching active database Admin profile", async () => {
    const { client, from, chain } = profileClient({
      data: { id: "10000000-0000-4000-8000-000000000001" },
      error: null,
    });
    await expect(requireActiveDocumentAdmin(
      client,
      "10000000-0000-4000-8000-000000000001",
    )).resolves.toBeUndefined();
    expect(from).toHaveBeenCalledWith("profiles");
    expect(chain.eq.mock.calls).toEqual([
      ["id", "10000000-0000-4000-8000-000000000001"],
      ["role", "ADMIN"],
      ["active", true],
    ]);
  });

  it("denies a deactivated/missing Admin even when a stale cookie says ADMIN", async () => {
    const { client } = profileClient({ data: null, error: null });
    await expect(requireActiveDocumentAdmin(
      client,
      "10000000-0000-4000-8000-000000000001",
    )).rejects.toMatchObject({
      code: "DOCUMENT_PERMISSION_DENIED",
      status: 403,
    });
  });

  it("fails closed when the active-profile verification cannot be read", async () => {
    const { client } = profileClient({
      data: null,
      error: { message: "database unavailable" },
    });
    await expect(requireActiveDocumentAdmin(
      client,
      "10000000-0000-4000-8000-000000000001",
    )).rejects.toMatchObject({
      code: "DOCUMENT_DATA_ACCESS_FAILED",
      status: 503,
    });
  });
});
