import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("Technician release navigation", () => {
  it("uses native keyboard-operable links with an accessible navigation label", () => {
    const shell = readFileSync(resolve(root, "src/components/technician-shell.tsx"), "utf8");
    expect(shell).toContain('aria-label="Technician navigation"');
    expect(shell).toContain("<Link");
    expect(shell).toContain('aria-current={activeKey === item.key ? "page" : undefined}');
    expect(shell).not.toContain("<TabBar");
  });

  it("routes History and Profile to implemented, truthful screens", () => {
    const page = readFileSync(resolve(root, "src/app/technician/page.tsx"), "utf8");
    const history = readFileSync(resolve(root, "src/components/technician/history.tsx"), "utf8");
    const profile = readFileSync(resolve(root, "src/components/technician/profile.tsx"), "utf8");
    expect(page).toContain("<TechnicianHistory />");
    expect(page).toContain("<TechnicianProfile");
    expect(history).toContain("technicianJobApi.history()");
    expect(profile).toContain("Primary branch");
    expect(`${page}${history}${profile}`).not.toContain("later workflow step");
  });

  it("keeps history reads assigned-Technician scoped and completed-only", () => {
    const service = readFileSync(resolve(root, "src/lib/services/technician-jobs/service.ts"), "utf8");
    expect(service).toContain("listTechnicianJobHistory");
    expect(service).toContain('.eq("assigned_technician_id", technicianId)');
    expect(service).toContain('.in("status", ["JOB_DONE", "REVIEWED", "CLOSED"])');
  });
});
