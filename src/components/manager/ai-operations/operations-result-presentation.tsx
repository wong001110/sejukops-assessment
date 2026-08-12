"use client";

import { Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";

import type {
  OperationsPresentation,
  OperationsToolCall,
} from "@/domain/ai-operations/contracts";

const periodLabels: Readonly<Record<string, string>> = {
  today: "Today",
  this_week: "This week",
  last_week: "Last week",
  this_month: "This month",
};

function money(value: number) {
  return new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: "MYR",
    minimumFractionDigits: 2,
  }).format(value);
}

function dateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

function argsOf(toolCall?: OperationsToolCall) {
  return toolCall?.arguments ?? {};
}

function stringArg(toolCall: OperationsToolCall | undefined, key: string) {
  const value = argsOf(toolCall)[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function periodLabel(toolCall?: OperationsToolCall) {
  const period = stringArg(toolCall, "period");
  return period ? periodLabels[period] ?? period : undefined;
}

function humanStatus(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function StatusTag({ status }: { status: string }) {
  return (
    <Tag className={`ai-order-status ai-order-status-${status.toLowerCase()}`}>
      {humanStatus(status)}
    </Tag>
  );
}

function ResultHeading({
  title,
  period,
  count,
}: {
  title: string;
  period?: string;
  count?: number;
}) {
  return (
    <div className="ai-result-heading">
      <div>
        <Typography.Text strong>{title}</Typography.Text>
        {period ? (
          <Typography.Text type="secondary">{period}</Typography.Text>
        ) : null}
      </div>
      {typeof count === "number" ? (
        <Tag>
          {count} {count === 1 ? "record" : "records"}
        </Tag>
      ) : null}
    </div>
  );
}

function JobsResult({
  presentation,
  toolCall,
}: {
  presentation: Extract<OperationsPresentation, { kind: "JOBS" }>;
  toolCall?: OperationsToolCall;
}) {
  const technician = stringArg(toolCall, "technicianName");
  const completedOnly = argsOf(toolCall).completedOnly === true;
  const orderNumber = stringArg(toolCall, "orderNumber");
  const title = orderNumber
    ? "Order details"
    : technician && completedOnly
      ? `${technician}'s completed jobs`
      : technician
        ? `${technician}'s matching jobs`
        : completedOnly
          ? "Completed jobs"
          : "Matching jobs";

  const columns: ColumnsType<(typeof presentation.rows)[number]> = [
    {
      title: "Order",
      dataIndex: "orderNumber",
      width: 160,
      render: (value: string) => (
        <Typography.Text className="ai-result-order" strong>
          {value}
        </Typography.Text>
      ),
    },
    { title: "Service", dataIndex: "serviceType", width: 175 },
    {
      title: completedOnly ? "Completed" : "Activity time",
      key: "activityTime",
      width: 178,
      render: (_, row) => dateTime(completedOnly ? row.completedAt : row.completedAt ?? row.scheduledAt),
    },
    {
      title: "Technician",
      dataIndex: "technicianName",
      width: 145,
      render: (value: string | null) => value ?? "Unassigned",
    },
    {
      title: "Amount",
      dataIndex: "finalAmount",
      width: 125,
      align: "right",
      render: (value: number) => money(value),
    },
    {
      title: "Status",
      dataIndex: "status",
      width: 125,
      render: (value: string) => <StatusTag status={value} />,
    },
  ];

  return (
    <section className="ai-structured-result" aria-label={title}>
      <ResultHeading
        title={title}
        period={periodLabel(toolCall)}
        count={presentation.rows.length}
      />
      <Table
        className="ai-result-table"
        rowKey="orderNumber"
        columns={columns}
        dataSource={[...presentation.rows]}
        size="small"
        pagination={false}
        scroll={{ x: 910 }}
      />
    </section>
  );
}

function TechnicianResult({
  presentation,
  toolCall,
}: {
  presentation: Extract<
    OperationsPresentation,
    { kind: "TECHNICIAN_PERFORMANCE" }
  >;
  toolCall?: OperationsToolCall;
}) {
  const technician = stringArg(toolCall, "technicianName");
  if (technician && presentation.rows.length === 1) {
    const row = presentation.rows[0];
    return (
      <section className="ai-structured-result" aria-label="Technician performance">
        <ResultHeading
          title={`${row.technicianName} performance`}
          period={periodLabel(toolCall)}
        />
        <div className="ai-result-metrics ai-result-metrics-two">
          <div>
            <Typography.Text type="secondary">Completed jobs</Typography.Text>
            <strong>{row.completedJobs}</strong>
          </div>
          <div>
            <Typography.Text type="secondary">Completed amount</Typography.Text>
            <strong>{money(row.completedAmount)}</strong>
          </div>
        </div>
      </section>
    );
  }

  const columns: ColumnsType<(typeof presentation.rows)[number]> = [
    {
      title: "Rank",
      key: "rank",
      width: 70,
      render: (_, __, index) => (
        <span className="ai-result-rank">{index + 1}</span>
      ),
    },
    { title: "Technician", dataIndex: "technicianName" },
    {
      title: "Completed jobs",
      dataIndex: "completedJobs",
      width: 145,
      align: "right",
    },
    {
      title: "Completed amount",
      dataIndex: "completedAmount",
      width: 170,
      align: "right",
      render: (value: number) => money(value),
    },
  ];

  return (
    <section className="ai-structured-result" aria-label="Technician performance">
      <ResultHeading
        title="Technician performance"
        period={periodLabel(toolCall)}
        count={presentation.rows.length}
      />
      <Table
        className="ai-result-table"
        rowKey="technicianId"
        columns={columns}
        dataSource={[...presentation.rows]}
        size="small"
        pagination={false}
        scroll={{ x: 600 }}
      />
    </section>
  );
}

function SummaryResult({
  presentation,
  toolCall,
}: {
  presentation: Extract<
    OperationsPresentation,
    { kind: "OPERATIONAL_SUMMARY" }
  >;
  toolCall?: OperationsToolCall;
}) {
  return (
    <section className="ai-structured-result" aria-label="Operational summary">
      <ResultHeading title="Operational summary" period={periodLabel(toolCall)} />
      <div className="ai-result-metrics ai-result-metrics-two">
        <div>
          <Typography.Text type="secondary">Completed jobs</Typography.Text>
          <strong>{presentation.completedJobs}</strong>
        </div>
        <div>
          <Typography.Text type="secondary">Total completed amount</Typography.Text>
          <strong>{money(presentation.totalAmount)}</strong>
        </div>
      </div>
    </section>
  );
}

function WorkloadResult({
  presentation,
  toolCall,
}: {
  presentation: Extract<OperationsPresentation, { kind: "WORKLOAD" }>;
  toolCall?: OperationsToolCall;
}) {
  const technician = stringArg(toolCall, "technicianName");
  if (technician && presentation.rows.length === 1) {
    const row = presentation.rows[0];
    return (
      <section className="ai-structured-result" aria-label="Technician workload">
        <ResultHeading
          title={`${row.technicianName} workload`}
          period={periodLabel(toolCall)}
        />
        <div className="ai-result-metrics ai-result-metrics-three">
          <div>
            <Typography.Text type="secondary">Active</Typography.Text>
            <strong>{row.activeJobs}</strong>
          </div>
          <div>
            <Typography.Text type="secondary">Assigned</Typography.Text>
            <strong>{row.assignedJobs}</strong>
          </div>
          <div>
            <Typography.Text type="secondary">In progress</Typography.Text>
            <strong>{row.inProgressJobs}</strong>
          </div>
        </div>
      </section>
    );
  }

  const columns: ColumnsType<(typeof presentation.rows)[number]> = [
    {
      title: "Rank",
      key: "rank",
      width: 70,
      render: (_, __, index) => (
        <span className="ai-result-rank">{index + 1}</span>
      ),
    },
    { title: "Technician", dataIndex: "technicianName" },
    { title: "Active", dataIndex: "activeJobs", width: 100, align: "right" },
    {
      title: "Assigned",
      dataIndex: "assignedJobs",
      width: 110,
      align: "right",
    },
    {
      title: "In progress",
      dataIndex: "inProgressJobs",
      width: 120,
      align: "right",
    },
  ];

  return (
    <section className="ai-structured-result" aria-label="Team workload">
      <ResultHeading
        title="Team workload"
        period={periodLabel(toolCall)}
        count={presentation.rows.length}
      />
      <Table
        className="ai-result-table"
        rowKey="technicianId"
        columns={columns}
        dataSource={[...presentation.rows]}
        size="small"
        pagination={false}
        scroll={{ x: 560 }}
      />
    </section>
  );
}

export function OperationsResultPresentation({
  presentation,
  toolCall,
}: {
  presentation: OperationsPresentation | null | undefined;
  toolCall?: OperationsToolCall;
}) {
  if (!presentation) return null;
  if (presentation.kind === "JOBS") {
    return <JobsResult presentation={presentation} toolCall={toolCall} />;
  }
  if (presentation.kind === "TECHNICIAN_PERFORMANCE") {
    return <TechnicianResult presentation={presentation} toolCall={toolCall} />;
  }
  if (presentation.kind === "OPERATIONAL_SUMMARY") {
    return <SummaryResult presentation={presentation} toolCall={toolCall} />;
  }
  return <WorkloadResult presentation={presentation} toolCall={toolCall} />;
}
