"use client";

import { CalendarOutline, EnvironmentOutline } from "antd-mobile-icons";
import { Button, Card, DotLoading, Empty, ErrorBlock, Space, Tag } from "antd-mobile";
import { useCallback, useEffect, useState } from "react";

import type { TechnicianJobHistoryItem } from "@/domain/technician-jobs/contracts";
import { formatMalaysiaDateTime } from "@/lib/time/malaysia";

import { technicianJobApi } from "./job-api";

const historyTone = { JOB_DONE: "warning", REVIEWED: "primary", CLOSED: "success" } as const;

export function TechnicianHistory() {
  const [jobs, setJobs] = useState<TechnicianJobHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try { setJobs((await technicianJobApi.history()).jobs); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Job history could not be loaded."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return <Space direction="vertical" block className="tech-stack">
    <header className="tech-page-heading"><p className="tech-kicker">Field operations</p><h1>Job history</h1><p>Your completed and reviewed service work, newest first.</p></header>
    {error ? <ErrorBlock status="default" title="We could not load job history" description={error} fullPage={false}><Button color="primary" size="small" onClick={() => void load()}>Try again</Button></ErrorBlock> : null}
    {loading ? <div className="tech-loading" aria-label="Loading job history"><DotLoading color="primary" /><span>Loading completed work…</span></div> : !error && (jobs.length ? <section className="tech-job-list" aria-label="Completed jobs">{jobs.map((job) => <Card key={job.id} className="tech-job-card"><div className="tech-job-topline"><Tag color={historyTone[job.status]} fill="outline">{job.status === "JOB_DONE" ? "Awaiting review" : job.status === "REVIEWED" ? "Reviewed" : "Closed"}</Tag><span className="tech-order-number">{job.orderNo}</span></div><h2>{job.customerName}</h2><p className="tech-service-type">{job.serviceType}</p><div className="tech-job-meta"><span><EnvironmentOutline /> {job.addressSummary}</span><span><CalendarOutline /> Updated {formatMalaysiaDateTime(job.updatedAt)}</span></div></Card>)}</section> : <Card className="tech-empty-card"><Empty description="No completed jobs yet" /><p className="tech-muted tech-center">Jobs appear here after you complete their service report.</p><Button fill="none" size="small" onClick={() => void load()}>Refresh history</Button></Card>)}
  </Space>;
}
