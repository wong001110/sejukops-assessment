"use client";

import { useEffect, useRef } from "react";

import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

import { acceptOwnerInvite } from "./invite-session";

export default function ConfirmOwnerInvitePage() {
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const inviteUrl = window.location.href;
    // Remove one-time credentials from the visible URL before any Auth request.
    window.history.replaceState(null, "", "/auth/confirm");

    void (async () => {
      try {
        const supabase = createBrowserSupabaseClient();
        const accepted = await acceptOwnerInvite(inviteUrl, supabase.auth);
        window.location.replace(accepted ? "/owner/set-password" : "/owner/login?error=invalid");
      } catch {
        window.location.replace("/owner/login?error=invalid");
      }
    })();
  }, []);

  return (
    <main style={{ maxWidth: 420, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Accepting Owner invitation</h1>
      <p>Verifying your invitation and preparing password setup…</p>
    </main>
  );
}
