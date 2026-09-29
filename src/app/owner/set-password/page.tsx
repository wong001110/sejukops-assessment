import { redirect } from "next/navigation";

import { getServerActorContext } from "@/lib/auth/server-actor";

import { setOwnerPassword } from "./actions";
import { Alert, Button, Card, Input, Tag } from "antd";
import Link from "next/link";

type Props = { searchParams: Promise<{ error?: string }> };

export default async function SetOwnerPasswordPage({ searchParams }: Props) {
  const actor = await getServerActorContext();
  if (!actor || actor.isAnonymous || actor.platformRole !== "SUPER_ADMIN") {
    redirect("/owner/login");
  }

  const { error } = await searchParams;
  return (
    <main className="product-page product-form-page"><div className="product-form-wrap">
      <Link className="product-brand" href="/">Sejuk<span>Ops</span></Link>
      <Card className="product-form-card product-note">
        <Tag color="green">Owner account</Tag>
        <h1>Set your password</h1>
        <p>Choose a password for future email sign-in. Use at least 12 characters.</p>
        {error === "invalid" && <Alert type="error" showIcon message="The password could not be set. Check both entries and try again." />}
        <form action={setOwnerPassword} className="product-form">
          <label className="product-field">Password<Input name="password" type="password" autoComplete="new-password" minLength={12} required size="large" /></label>
          <label className="product-field">Confirm password<Input name="confirmation" type="password" autoComplete="new-password" minLength={12} required size="large" /></label>
          <Button type="primary" htmlType="submit" size="large">Save password</Button>
        </form>
      </Card></div>
    </main>
  );
}
