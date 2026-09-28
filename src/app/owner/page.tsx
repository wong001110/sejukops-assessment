import { redirect } from "next/navigation";

import { getServerActorContext } from "@/lib/auth/server-actor";

import { signOutOwner } from "./login/actions";

export default async function OwnerPage() {
  const actor = await getServerActorContext();
  if (!actor || actor.isAnonymous || actor.platformRole !== "SUPER_ADMIN") {
    redirect("/owner/login");
  }

  return (
    <main style={{ maxWidth: 680, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Owner account</h1>
      <p>Your session is verified. Business records will appear after Owner workspace provisioning and isolation checks.</p>
      <form action={signOutOwner}>
        <button type="submit">Sign out</button>
      </form>
    </main>
  );
}
