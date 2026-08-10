"use client";
import { Button, Result } from "antd";
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) { return <main className="status-page"><Result status="error" title="We could not load this workspace" subTitle="Your role selection is still safe. Please retry the page." extra={<Button type="primary" onClick={reset}>Retry</Button>} /></main>; }
