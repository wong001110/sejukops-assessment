import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const roleSwitcher = readFileSync("src/components/role-switcher.tsx", "utf8");
const technicianShell = readFileSync("src/components/technician-shell.tsx", "utf8");

describe("role switcher UI", () => {
  it("uses Ant Design Select instead of a native select", () => {
    expect(roleSwitcher).toContain('import { Select } from "antd"');
    expect(roleSwitcher).toContain("<Select");
    expect(roleSwitcher).not.toContain("<select");
  });

  it("keeps the selected identity in the posted demo-session form", () => {
    expect(roleSwitcher).toContain('name="identityId"');
    expect(roleSwitcher).toContain("selectedIdentityId");
    expect(roleSwitcher).toContain('action="/api/demo-session"');
  });

  it("allows the selector to shrink safely inside narrow technician layouts", () => {
    expect(roleSwitcher).toContain('minWidth: 0');
    expect(roleSwitcher).toContain('width: "100%"');
    expect(roleSwitcher).not.toContain('minWidth: 260');
    expect(technicianShell).toContain('gridTemplateColumns: "minmax(0, 1fr)"');
    expect(technicianShell).toContain('technician-role-caption');
  });
});
