"use client";

import Link from "next/link";
import { Button, Result } from "antd";
export default function AccessDenied() { return <main className="status-page"><Result status="403" title="This portal is not available for the active demo role" subTitle="Switch identities to view the matching workspace." extra={<Button type="primary"><Link href="/">Return to role switcher</Link></Button>} /></main>; }
