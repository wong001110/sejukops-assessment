"use client";
import { Button, Result } from "antd";
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) { return <main className="status-page"><Result status="error" title="We could not load this workspace" subTitle="Please retry the page, or return to your Owner account to clear an expired preview." extra={[<Button key="retry" type="primary" onClick={reset}>Retry</Button>, <Button key="owner" href="/owner">Return to Owner</Button>]} /></main>; }
