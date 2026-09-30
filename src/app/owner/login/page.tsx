import { signInOwner } from "./actions";
import { Alert, Button, Card, Input, Tag } from "antd";
import Link from "next/link";

type Props = { searchParams: Promise<{ error?: string }> };

export default async function OwnerLoginPage({ searchParams }: Props) {
  const { error } = await searchParams;

  return (
    <main className="product-page product-form-page"><div className="product-form-wrap">
      <Link className="product-brand" href="/">Sejuk<span>Ops</span></Link>
      <Card className="product-form-card product-note">
      <Tag color="green">Owner access</Tag>
      <h1>Welcome back</h1>
      <p>Use your permanent Sejuk Ops account to sign in.</p>
      {error === "invalid" && <Alert type="error" showIcon message="Sign in failed or this account is not authorized." />}
      <form action={signInOwner} className="product-form">
        <label className="product-field">Email<Input name="email" type="email" autoComplete="username" required size="large" /></label>
        <label className="product-field">Password<Input name="password" type="password" autoComplete="current-password" required size="large" /></label>
        <Button type="primary" htmlType="submit" size="large">Sign in</Button>
      </form></Card></div>
    </main>
  );
}
