import { describe, expect, it } from "vitest";
import { parseOrderFocusId } from "./order-focus";

describe("Agent order focus", () => {
  it("keeps a valid selected order UUID", () => {
    const id = "f5f23c30-fdda-402f-8529-27692d3235b1";
    expect(parseOrderFocusId(id)).toBe(id);
  });

  it("drops malformed IDs and duplicate query values", () => {
    expect(parseOrderFocusId("f5f23c30-fdda-402f-8529-27692d3235b1/other")).toBeUndefined();
    expect(parseOrderFocusId("not-an-order")).toBeUndefined();
    expect(parseOrderFocusId(["f5f23c30-fdda-402f-8529-27692d3235b1"])).toBeUndefined();
  });
});
