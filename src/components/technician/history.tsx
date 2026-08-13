"use client";

import { CalendarOutline, EnvironmentOutline } from "antd-mobile-icons";
import { Button, Card, DotLoading, Empty, ErrorBlock, Space, Tag } from "antd-mobile";
import { useCallback, useEffect, useRef, useState } from "react";

import type { TechnicianJobHistoryItem, TechnicianPaginationMeta } from "@/domain/technician-jobs/contracts";
import { formatMalaysiaDateTime } from "@/lib/time/malaysia";
import { technicianJobListApi } from "./job-list-api";

const historyTone = { JOB_DONE: "warning", REVIEWED: "primary", CLOSED: "success" } as const;
const initialPagination: TechnicianPaginationMeta = { page: 1, pageSize: 10, total: 0, totalPages: 1, hasMore: false };
function mergeJobs(current: TechnicianJobHistoryItem[], next: TechnicianJobHistoryItem[]) { const map = new Map(current.map((job) => [job.id, job])); for (const job of next) map.set(job.id, job); return [...map.values()]; }

export function TechnicianHistory() {
  const [jobs, setJobs] = useState<TechnicianJobHistoryItem[]>([]);
  const [pagination, setPagination] = useState<TechnicianPaginationMeta>(initialPagination);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();
  const sentinelRef = useRef<HTMLDivElement>(null);

  const loadPage = useCallback(async (page: number, replace = false) => {
    if (replace) { setLoading(true); setError(undefined); } else setLoadingMore(true);
    try {
      const result = await technicianJobListApi.history(page, 10);
      setJobs((current) => replace ? result.jobs : mergeJobs(current, result.jobs));
      setPagination(result.pagination);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Job history could not be loaded."); }
    finally { if (replace) setLoading(false); else setLoadingMore(false); }
  }, []);
  const load = useCallback(() => loadPage(1, true), [loadPage]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || loading || loadingMore || error || !pagination.hasMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) void loadPage(pagination.page + 1);
    }, { rootMargin: "240px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [error, loadPage, loading, loadingMore, pagination.hasMore, pagination.page]);

  return <Space direction="vertical" block className="tech-stack">
    <header className="tech-page-heading"><p className="tech-kicker">Field operations</p><h1>Job history</h1><p>Your completed and reviewed service work, newest first.</p></header>
    {error ? <ErrorBlock status="default" title="We could not load job history" description={error} fullPage={false}><Button color="primary" size="small" onClick={() => void load()}>Try again</Button></ErrorBlock> : null}
    {loading ? <div className="tech-loading" aria-label="Loading job history"><DotLoading color="primary" /><span>Loading completed work…</span></div> : !error && (jobs.length ? <><section className="tech-job-list" aria-label="Completed jobs">{jobs.map((job) => <Card key={job.id} className="tech-job-card"><div className="tech-job-topline"><Tag color={historyTone[job.status]} fill="outline">{job.status === "JOB_DONE" ? "Awaiting review" : job.status === "REVIEWED" ? "Reviewed" : "Closed"}</Tag><span className="tech-order-number">{job.orderNo}</span></div><h2>{job.customerName}</h2><p className="tech-service-type">{job.serviceType}</p><div className="tech-job-meta"><span><EnvironmentOutline /> {job.addressSummary}</span><span><CalendarOutline /> Updated {formatMalaysiaDateTime(job.updatedAt)}</span></div></Card>)}</section><div ref={sentinelRef} className="tech-infinite-sentinel" aria-live="polite">{loadingMore ? <><DotLoading color="primary" /> Loading more history…</> : pagination.hasMore ? "Scroll for more history" : `All ${pagination.total} historical job${pagination.total === 1 ? "" : "s"} loaded`}</div></> : <Card className="tech-empty-card"><Empty description="No completed jobs yet" /><p className="tech-muted tech-center">Jobs appear here after you complete their service report.</p><Button fill="none" size="small" onClick={() => void load()}>Refresh history</Button></Card>)}
  </Space>;
}
