"use client";

import { Select } from "antd";
import { useState } from "react";

import type { DemoPersona } from "@/lib/auth/demo-entry";
import styles from "./guest-perspective-select.module.css";

const options: Array<{ value: DemoPersona; label: string }> = [
  { value: "ADMIN", label: "Admin" },
  { value: "MANAGER", label: "Manager" },
  { value: "TECHNICIAN", label: "Technician" },
];

export function GuestPerspectiveSelect({ value }: { value: DemoPersona }) {
  const [persona, setPersona] = useState(value);

  return <div className={styles.field}>
    <label htmlFor="workspace-persona">Perspective</label>
    <Select<DemoPersona>
      id="workspace-persona"
      aria-label="Perspective"
      className={styles.select}
      value={persona}
      options={options}
      onChange={setPersona}
    />
    <input type="hidden" name="persona" value={persona} />
  </div>;
}
