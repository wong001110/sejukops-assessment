import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const workspace = readFileSync(resolve("src/components/admin/order-workspace.tsx"), "utf8");

describe("Admin order workspace", () => {
  it("uses a persistent-action drawer for creating an order", () => {
    expect(workspace).toContain('<Drawer className="create-order-drawer" title="Create service order"');
    expect(workspace).toContain('form="create-order-form"');
    expect(workspace).toContain('<Form id="create-order-form"');
    expect(workspace).not.toContain('<Modal title="Create service order"');
  });
});
