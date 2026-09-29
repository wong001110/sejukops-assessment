import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  guestTokenHash, issueGuestVisit, pruneExpiredGuestVisits, resolveGuestVisit,
} from "./guest-session";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const visitId = "00000000-0000-4000-8000-000000000002";
const token = "a".repeat(43);

function fakeService(options: {
  tokenHash?: string;
  expired?: boolean;
  revoked?: boolean;
  kind?: string;
  generation?: number;
} = {}) {
  const lookups: { table: string; column: string; value: unknown }[] = [];
  const row = {
    id: visitId,
    workspace_id: workspaceId,
    persona: "MANAGER",
    demo_generation: 2,
    expires_at: new Date(Date.now() + (options.expired ? -1000 : 3600000)).toISOString(),
    revoked_at: options.revoked ? new Date().toISOString() : null,
  };
  const from = vi.fn((table: string) => {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn((column: string, value: unknown) => {
        lookups.push({ table, column, value });
        return chain;
      }),
      insert: vi.fn(() => chain),
      single: vi.fn(async () => ({ data: { id: visitId }, error: null })),
      maybeSingle: vi.fn(async () => ({
        data: table === "guest_visits"
          ? (lookups.filter((lookup) => lookup.table === table && lookup.column === "token_hash").at(-1)?.value === options.tokenHash
              ? row : null)
          : { id: workspaceId, kind: options.kind ?? "DEMO", active: true, generation: options.generation ?? 2 },
        error: null,
      })),
    };
    return chain;
  });
  return { service: { from } as unknown as SupabaseClient, lookups, from };
}

describe("opaque Guest visit", () => {
  it("prunes only visits expired for more than a day", async () => {
    const lt = vi.fn().mockResolvedValue({ error: null });
    const remove = vi.fn(() => ({ lt }));
    const service = { from: vi.fn(() => ({ delete: remove })) } as unknown as SupabaseClient;
    const before = Date.now();
    await pruneExpiredGuestVisits(service);
    const after = Date.now();
    expect(service.from).toHaveBeenCalledWith("guest_visits");
    expect(remove).toHaveBeenCalledOnce();
    const cutoff = Date.parse(lt.mock.calls[0][1]);
    expect(lt.mock.calls[0][0]).toBe("expires_at");
    expect(cutoff).toBeGreaterThanOrEqual(before - 24 * 60 * 60 * 1000);
    expect(cutoff).toBeLessThanOrEqual(after - 24 * 60 * 60 * 1000);
  });

  it("persists only a digest of a random bearer and binds Demo generation", async () => {
    const { service, from } = fakeService();
    const issued = await issueGuestVisit(service, "TECHNICIAN");
    expect(issued?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issued?.visit.workspaceId).toBe(workspaceId);
    expect(issued?.visit.demoGeneration).toBe(2);
    const insert = from.mock.results[1]?.value.insert;
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      token_hash: guestTokenHash(issued!.token),
      workspace_id: workspaceId,
      persona: "TECHNICIAN",
      demo_generation: 2,
    }));
    expect(JSON.stringify(insert.mock.calls)).not.toContain(issued!.token);
  });

  it("denies malformed, tampered, expired, revoked, Owner, and reset-era visits", async () => {
    const valid = fakeService({ tokenHash: guestTokenHash(token) });
    expect((await resolveGuestVisit(valid.service, token))?.persona).toBe("MANAGER");
    expect(await resolveGuestVisit(valid.service, "forged")).toBeNull();
    expect(await resolveGuestVisit(valid.service, "b".repeat(43))).toBeNull();
    expect(await resolveGuestVisit(fakeService({ tokenHash: guestTokenHash(token), expired: true }).service, token)).toBeNull();
    expect(await resolveGuestVisit(fakeService({ tokenHash: guestTokenHash(token), revoked: true }).service, token)).toBeNull();
    expect(await resolveGuestVisit(fakeService({ tokenHash: guestTokenHash(token), kind: "OWNER" }).service, token)).toBeNull();
    expect(await resolveGuestVisit(fakeService({ tokenHash: guestTokenHash(token), generation: 3 }).service, token)).toBeNull();
  });
});
