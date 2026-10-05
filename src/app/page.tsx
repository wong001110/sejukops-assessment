import { ArrowRightOutlined, BookOutlined, RobotOutlined, ScheduleOutlined, SettingOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Space, Tag } from "antd";
import Link from "next/link";

import { hasActorPermission } from "@/lib/auth/actor-policy";
import { getServerActorContext } from "@/lib/auth/server-actor";
import { malaysiaTimeZoneLabel } from "@/lib/time/malaysia";

export default async function Home() {
  const hasSupabaseConfig = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const platformActor = hasSupabaseConfig ? await getServerActorContext().catch(() => null) : null;
  const canViewPlatform = Boolean(platformActor && hasActorPermission(platformActor, "diagnostics:view"));

  return <main className="product-page">
    <div className="product-container">
      <header className="product-header">
        <Link href="/" className="product-brand">Sejuk<span>Ops</span></Link>
        <Space wrap><Button href="/demo">Explore Demo</Button><Button href="/login">Staff sign in</Button><Button type="primary" href="/owner/login">Owner sign in</Button></Space>
      </header>
      <section className="product-hero">
        <Tag color="green">Field service workspace</Tag>
        <h1>Service work, clearly in motion.</h1>
        <p>Plan, assign, and follow orders in one workspace. Use guided AI assistance where it helps, with each action grounded in your workspace permissions.</p>
        <div className="product-actions">
          <Button type="primary" size="large" href="/demo">Explore the shared Demo <ArrowRightOutlined /></Button>
          <Button size="large" href="/owner/login">Sign in as Owner</Button>
        </div>
        <p className="product-muted">Schedules use {malaysiaTimeZoneLabel()}.</p>
      </section>
      <section aria-labelledby="ways-heading">
        <h2 id="ways-heading" className="product-section-title">One operational core, three ways to work</h2>
        <div className="product-feature-grid">
          <Card className="product-feature-card"><div className="product-icon"><ScheduleOutlined /></div><h3>Traditional + AI Assist</h3><p>Inspect orders directly and ask for help in the context of the work at hand.</p></Card>
          <Card className="product-feature-card"><div className="product-icon"><RobotOutlined /></div><h3>Agent Workspace</h3><p>Explore guided tasks and review a saved proposal before a consequential change.</p></Card>
          <Card className="product-feature-card"><div className="product-icon"><BookOutlined /></div><h3>Connected knowledge</h3><p>Find published workspace knowledge with citations from supported tools.</p></Card>
        </div>
      </section>
      <Card className="product-feature-card" aria-label="Platform administration">
        <div className="product-platform-summary"><div className="product-icon"><SettingOutlined /></div><div className="product-platform-content">
          <h2 className="product-section-title" style={{ marginBottom: 5 }}>Platform administration</h2>
          <p className="product-muted">AI provider settings and technical observations require a platform Super Admin account.</p>
          {canViewPlatform ? <Space wrap><Button href="/platform/ai-settings">AI settings</Button><Button href="/diagnostics/ai-observability">AI observability</Button></Space> : <Button href="/owner/login">Sign in as Super Admin</Button>}
        </div></div>
      </Card>
      {!hasSupabaseConfig && <Alert className="product-note" type="warning" showIcon message="Setup is incomplete" description="Supabase connection settings are not configured yet." />}
    </div>
  </main>;
}
