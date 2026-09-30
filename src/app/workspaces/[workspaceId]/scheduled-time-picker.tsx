"use client";

import { DatePicker } from "antd";
import dayjs from "dayjs";

export function ScheduledTimePicker({ value, onChange, disabled, label }: {
  value: string; onChange: (value: string) => void; disabled: boolean; label: string;
}) {
  return <DatePicker aria-label={label} showTime={{ format: "HH:mm" }} format="YYYY-MM-DD HH:mm"
    placeholder="YYYY-MM-DD HH:mm" needConfirm={false} allowClear disabled={disabled} style={{ width: "100%" }}
    value={value ? dayjs(value) : null} onChange={(date) => onChange(date ? date.format("YYYY-MM-DDTHH:mm") : "")} />;
}
