import { describe, expect, it } from "vitest";
import { resolveVisibleOrderId } from "./order-selection";

const orders = [{ id: "visible-1" }, { id: "visible-2" }];

describe("visible order selection", () => {
  it("keeps the selected order while it remains visible", () => {
    expect(resolveVisibleOrderId(orders, "visible-2", "visible-1")).toBe("visible-2");
  });

  it("uses a valid deep link when the prior selection disappears", () => {
    expect(resolveVisibleOrderId(orders, "removed", "visible-1")).toBe("visible-1");
  });

  it("clears a selection that is no longer visible", () => {
    expect(resolveVisibleOrderId(orders, "removed", "also-removed")).toBe("");
  });
});
