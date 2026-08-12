"use client";

import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  BulbOutlined,
  DatabaseOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Collapse,
  Modal,
  Skeleton,
  Space,
  Tag,
  Typography,
} from "antd";
import { useMemo, useState } from "react";

import type { OperationsFact } from "@/domain/ai-operations/contracts";
import type { ManagerDashboardResponse } from "@/domain/manager-dashboard/contracts";
import {
  AIOperationsClientError,
  aiRecoveryCopy,
  fetchOperationalInsight,
} from "./api";

export const operationalInsightQueryKey = (
  period: ManagerDashboardResponse["period"],
  metricsVersion: string,
) => ["manager-operational-insight", period, metricsVersion] as const;

const metricLabels = {
  completedJobs: "Completed jobs",
  totalAmount: "Total amount",
  rescheduled: "Rescheduled jobs",
  averageJobValue: "Average job value",
} as const;

type ComparisonMetricKey = keyof typeof metricLabels;

function formatFactLabel(label: string) {
  return label
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatPeriod(value: ManagerDashboardResponse["period"]) {
  if (value === "today") return "Today";
  if (value === "this_week") return "This week";
  return "This month";
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: "MYR",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-MY", {
    maximumFractionDigits: 2,
  }).format(value);
}

function formatMetricValue(key: ComparisonMetricKey, value: number) {
  return key === "totalAmount" || key === "averageJobValue"
    ? formatCurrency(value)
    : formatNumber(value);
}

function formatFactValue(fact: OperationsFact) {
  if (Array.isArray(fact.value)) return fact.value.join(", ");
  if (typeof fact.value !== "number") {
    if (fact.kind === "DATE_RANGE") {
      const date = new Date(fact.value);
      if (!Number.isNaN(date.getTime())) {
        return new Intl.DateTimeFormat("en-MY", {
          dateStyle: "medium",
          timeZone: "Asia/Kuala_Lumpur",
        }).format(date);
      }
    }
    return fact.value;
  }
  if (fact.kind === "AMOUNT") return formatCurrency(fact.value);
  if (fact.key.endsWith("percent_change")) {
    return `${fact.value > 0 ? "+" : ""}${formatNumber(fact.value)}%`;
  }
  return formatNumber(fact.value);
}

function comparisonTone(
  key: ComparisonMetricKey,
  percentChange: number | null,
) {
  if (percentChange === null || percentChange === 0) return "neutral";
  if (key === "rescheduled") return percentChange < 0 ? "positive" : "negative";
  if (key === "averageJobValue") return "neutral";
  return percentChange > 0 ? "positive" : "negative";
}

function parseInsight(insight: string) {
  const sections = insight
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  const headline = sections[0] ?? insight;
  const recommendationSection = sections.find((part) =>
    part.toLowerCase().startsWith("suggested follow-up:"),
  );
  const recommendation = recommendationSection
    ? recommendationSection.replace(/^suggested follow-up:\s*/i, "")
    : null;
  const observations = sections.slice(1).filter(
    (part) => !part.toLowerCase().startsWith("suggested follow-up:"),
  );
  return { headline, observations, recommendation };
}

function InsightMetrics({ dashboard }: { dashboard: ManagerDashboardResponse }) {
  const keys: ComparisonMetricKey[] = [
    "completedJobs",
    "totalAmount",
    "rescheduled",
    "averageJobValue",
  ];

  return (
    <div className="operational-insight-metrics" aria-label="Key KPI changes">
      {keys.map((key) => {
        const metric = dashboard.comparison[key];
        const tone = comparisonTone(key, metric.percentChange);
        return (
          <div className="operational-insight-metric" key={key}>
            <span>{metricLabels[key]}</span>
            <strong>{formatMetricValue(key, metric.current)}</strong>
            <div className={`operational-insight-delta operational-insight-delta-${tone}`}>
              {metric.percentChange === null || metric.percentChange === 0 ? null :
                metric.percentChange > 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
              {metric.percentChange === null
                ? "No comparison"
                : `${Math.abs(metric.percentChange).toFixed(1)}% vs ${dashboard.range.comparisonLabel}`}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function GroundedEvidence({
  facts,
  citations,
}: {
  facts: readonly OperationsFact[];
  citations: readonly string[];
}) {
  const cited = useMemo(() => {
    const citedKeys = new Set(citations);
    return facts.filter((fact) => citedKeys.has(fact.key));
  }, [citations, facts]);

  return (
    <div className="operational-insight-evidence">
      <div className="operational-insight-evidence-grid">
        {cited.map((fact) => (
          <div key={fact.key}>
            <span>{formatFactLabel(fact.label)}</span>
            <strong>{formatFactValue(fact)}</strong>
          </div>
        ))}
      </div>
      <div className="operational-insight-evidence-footer">
        <DatabaseOutlined /> {cited.length} cited dashboard facts · {citations.length} citations
      </div>
    </div>
  );
}

export function OperationalInsight({
  dashboard,
}: {
  dashboard: ManagerDashboardResponse;
}) {
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: operationalInsightQueryKey(
      dashboard.period,
      dashboard.metricsVersion,
    ),
    queryFn: () =>
      fetchOperationalInsight({
        period: dashboard.period,
        metricsVersion: dashboard.metricsVersion,
      }),
    staleTime: 60_000,
    enabled: open,
  });
  const error =
    query.error instanceof AIOperationsClientError
      ? query.error.details
      : ({
          code: "AI_PROVIDER_UNAVAILABLE",
          message: "The AI insight could not be completed.",
          retryable: true,
          action: "RETRY",
        } as const);
  const parsedInsight = query.data ? parseInsight(query.data.insight) : null;

  return (
    <>
      <Card className="dashboard-ai-teaser" bordered={false}>
        <div className="dashboard-ai-teaser-copy">
          <span className="dashboard-ai-teaser-icon" aria-hidden>
            <BulbOutlined />
          </span>
          <div>
            <Typography.Text className="dashboard-kicker">
              AI decision support
            </Typography.Text>
            <Typography.Title level={5}>
              Explain this operational snapshot
            </Typography.Title>
            <Typography.Paragraph>
              Open a grounded interpretation of the current KPI period. The
              assistant only uses approved dashboard facts.
            </Typography.Paragraph>
          </div>
        </div>
        <Button type="primary" onClick={() => setOpen(true)}>
          Open insight
        </Button>
      </Card>

      <Modal
        className="operational-insight-modal"
        title={
          <div className="operational-insight-modal-title">
            <span className="operational-insight-title-icon" aria-hidden>
              <BulbOutlined />
            </span>
            <div>
              <strong>AI decision support</strong>
              <span>{formatPeriod(dashboard.period)} operational snapshot</span>
            </div>
            <Tag color="blue">Grounded</Tag>
          </div>
        }
        open={open}
        onCancel={() => setOpen(false)}
        footer={<Button onClick={() => setOpen(false)}>Close</Button>}
        width={1040}
        destroyOnHidden
      >
        {query.isPending ? (
          <div className="operational-insight-loading">
            <Skeleton
              active
              title={{ width: "45%" }}
              paragraph={{ rows: 5 }}
            />
          </div>
        ) : query.isError ? (
          <Alert
            type="warning"
            showIcon
            message="AI insight unavailable"
            description={
              <div>
                <div>{error.message}</div>
                <Typography.Text type="secondary">
                  {aiRecoveryCopy(error.action)}
                </Typography.Text>
                <Typography.Paragraph>
                  The deterministic KPI dashboard remains available.
                </Typography.Paragraph>
              </div>
            }
            action={
              error.retryable ? (
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  onClick={() => void query.refetch()}
                >
                  Retry
                </Button>
              ) : undefined
            }
          />
        ) : query.data && parsedInsight ? (
          <div className="operational-insight-layout">
            <section className="operational-insight-summary">
              <div className="operational-insight-section-heading">
                <span>Executive summary</span>
                {query.data.cached ? <Tag>Cached</Tag> : <Tag color="blue">Fresh</Tag>}
              </div>
              <h2>{parsedInsight.headline}</h2>
              <InsightMetrics dashboard={dashboard} />
            </section>

            <section className="operational-insight-analysis">
              <div className="operational-insight-section-heading">
                <span>What changed</span>
              </div>
              {parsedInsight.observations.length ? (
                <ul>
                  {parsedInsight.observations.map((observation) => (
                    <li key={observation}>{observation}</li>
                  ))}
                </ul>
              ) : (
                <Typography.Paragraph>{query.data.insight}</Typography.Paragraph>
              )}

              {parsedInsight.recommendation ? (
                <div className="operational-insight-recommendation">
                  <span>Suggested follow-up</span>
                  <p>{parsedInsight.recommendation}</p>
                </div>
              ) : null}
            </section>

            <Collapse
              size="small"
              className="ai-operations-grounding operational-insight-grounding"
              items={[
                {
                  key: "facts",
                  label: (
                    <div className="operational-insight-grounding-label">
                      <span>Grounded evidence</span>
                      <span>{query.data.citations.length} cited facts</span>
                    </div>
                  ),
                  children: (
                    <GroundedEvidence
                      facts={query.data.facts}
                      citations={query.data.citations}
                    />
                  ),
                },
              ]}
            />

            <div className="operational-insight-footnote">
              Grounded in the current {formatPeriod(dashboard.period).toLowerCase()} KPI snapshot · {query.data.metadata.timezone}
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
