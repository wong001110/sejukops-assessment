import Link from "next/link";
import { Alert, Button, Card, Input, Tag } from "antd";
import { signInStaff } from "./actions";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { error, notice } = await searchParams;
  return <main className="product-page product-form-page"><div className="product-form-wrap">
    <Link className="product-brand" href="/">Sejuk<span>Ops</span></Link>
    <Card className="product-form-card product-note">
      <Tag color="blue">Staff access</Tag><h1>Sign in</h1>
      <p>Use the account your Owner created for you. Your workspace and role are assigned automatically.</p>
      {error && <Alert type="error" showIcon message="Sign in failed or this account is unavailable. Contact your Owner if you need a new temporary password." />}
      {!error && notice === "password-changed" && <Alert type="success" showIcon message="Password changed. Sign in again to open your workspace." />}
      <form action={signInStaff} className="product-form">
        <label className="product-field">Email<Input name="email" type="email" required autoComplete="username" maxLength={254} size="large" /></label>
        <label className="product-field">Password<Input name="password" type="password" required autoComplete="current-password" maxLength={128} size="large" /></label>
        <Button type="primary" htmlType="submit" size="large">Sign in</Button>
      </form>
      <p><Link href="/demo">Continue as Guest</Link> · <Link href="/owner/login">Owner sign in</Link></p>
    </Card>
  </div></main>;
}
