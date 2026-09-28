import type { SupabaseClient } from "@supabase/supabase-js";

const TOKEN_HASH = /^[a-zA-Z0-9_-]{1,256}$/;

type InviteCredentials =
  | { kind: "hash"; tokenHash: string }
  | { kind: "session"; accessToken: string; refreshToken: string };

/** Parse only invite credentials. Never accept a caller-supplied next URL. */
export function readInviteCredentials(url: string): InviteCredentials | null {
  const parsed = new URL(url);
  const tokenHash = parsed.searchParams.get("token_hash");
  const queryType = parsed.searchParams.get("type");
  const fragment = new URLSearchParams(parsed.hash.slice(1));
  const accessToken = fragment.get("access_token");
  const refreshToken = fragment.get("refresh_token");
  const fragmentType = fragment.get("type");

  if (tokenHash !== null) {
    if (queryType !== "invite" || !TOKEN_HASH.test(tokenHash) || accessToken || refreshToken) return null;
    return { kind: "hash", tokenHash };
  }
  if (
    !accessToken || !refreshToken ||
    accessToken.length > 8192 || refreshToken.length > 8192 ||
    (queryType !== null && queryType !== "invite") ||
    (fragmentType !== null && fragmentType !== "invite")
  ) return null;
  return { kind: "session", accessToken, refreshToken };
}

/** The following server page independently verifies the database Super Admin actor. */
export async function acceptOwnerInvite(
  url: string,
  auth: Pick<SupabaseClient["auth"], "setSession" | "verifyOtp" | "getUser" | "signOut">,
): Promise<boolean> {
  const credentials = readInviteCredentials(url);
  if (!credentials) return false;

  const result = credentials.kind === "hash"
    ? await auth.verifyOtp({ type: "invite", token_hash: credentials.tokenHash })
    : await auth.setSession({ access_token: credentials.accessToken, refresh_token: credentials.refreshToken });
  if (result.error) return false;

  const { data, error } = await auth.getUser();
  if (error || !data.user || data.user.is_anonymous === true) {
    await auth.signOut();
    return false;
  }
  return true;
}
