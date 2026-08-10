"use client";

import Link from "next/link";
import { Button, Result } from "antd";
export default function NotFound() { return <main className="status-page"><Result status="404" title="Page not found" subTitle="This workspace route is not available yet." extra={<Button type="primary"><Link href="/">Return home</Link></Button>} /></main>; }
