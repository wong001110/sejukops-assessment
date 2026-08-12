"use client";

import { Tag } from "antd";
import type { ReactNode } from "react";

export type StatusTone =
  | "neutral"
  | "info"
  | "warning"
  | "success"
  | "danger"
  | "violet"
  | "teal";

const defaultTones: Readonly<Record<string, StatusTone>> = {
  NEW: "neutral",
  ASSIGNED: "info",
  IN_PROGRESS: "warning",
  JOB_DONE: "teal",
  REVIEWED: "violet",
  CLOSED: "success",
  SUCCEEDED: "success",
  CONTROLLED: "info",
  FAILED: "danger",
  ERROR: "danger",
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
  AVAILABLE: "success",
  UNAVAILABLE: "danger",
};

export function formatStatusLabel(value: string): string {
  return value
    .trim()
    .replace(/[-_]+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function statusTone(value: string): StatusTone {
  return defaultTones[value.trim().toUpperCase()] ?? "neutral";
}

export function StatusTag({
  status,
  tone,
  label,
  className,
}: {
  status: string;
  tone?: StatusTone;
  label?: ReactNode;
  className?: string;
}) {
  const resolvedTone = tone ?? statusTone(status);
  const classes = ["status-tag", `status-tag-${resolvedTone}`, className]
    .filter(Boolean)
    .join(" ");

  return <Tag className={classes}>{label ?? formatStatusLabel(status)}</Tag>;
}
