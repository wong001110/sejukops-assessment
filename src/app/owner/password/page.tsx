import { Card, Tag } from "antd";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getServerActorContext } from "@/lib/auth/server-actor";

import { OwnerPasswordForm } from "./password-form";

export default async function OwnerPasswordPage() {
  const actor = await getServerActorContext();
  if (!actor || actor.isAnonymous || actor.platformRole !== "SUPER_ADMIN") {
    redirect("/owner/login");
  }
  return <main className="product-page product-form-page"><div className="product-form-wrap">
    <Link className="product-brand" href="/">Sejuk<span>Ops</span></Link>
    <Card className="product-form-card product-note">
      <Tag color="green">Verified Owner</Tag>
      <h1>Change password</h1>
      <p>Confirm your current password and choose a new one. This form does not request a reset email.</p>
      <OwnerPasswordForm />
      <Link href="/owner">Back to Owner account</Link>
    </Card></div>
  </main>;
}
