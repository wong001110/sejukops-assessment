import { describe, expect, it } from "vitest";
import { workspaceEntryPage } from "./workspace-entry-path";
describe("role workspace landing", () => {
  it("opens Manager Dashboard and Admin or Technician orders", () => {
    expect(workspaceEntryPage("MANAGER")).toBe("overview");
    expect(workspaceEntryPage("ADMIN")).toBe("orders");
    expect(workspaceEntryPage("TECHNICIAN")).toBe("orders");
    expect(workspaceEntryPage(undefined)).toBe("orders");
  });
});
