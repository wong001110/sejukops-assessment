import { redirect } from "next/navigation";
import { Alert, Button, Card } from "antd";
import Link from "next/link";
import { getServerActorContext } from "@/lib/auth/server-actor";
import { signOutStaff } from "@/app/login/actions";
import { StaffPasswordForm } from "./password-form";

export default async function StaffPasswordPage() {
  const actor = await getServerActorContext().catch(() => null);
  if (!actor || !actor.staff || !actor.staff.sessionAllowed || actor.platformRole !== "USER") redirect("/login?error=session");
  return <main className="product-page product-form-page"><div className="product-form-wrap">
    <Link className="product-brand" href="/">Sejuk<span>Ops</span></Link>
    <Card className="product-form-card product-note"><h1>{actor.staff.passwordChangeRequired ? "Set your own password" : "Change password"}</h1>
      {actor.staff.passwordChangeRequired && <Alert type="info" showIcon message="Complete password setup before opening business data. No email will be sent." />}
      <StaffPasswordForm />
      <form action={signOutStaff}><Button htmlType="submit">Sign out</Button></form>
    </Card>
  </div></main>;
}
