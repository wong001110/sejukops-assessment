import { describe, expect, it } from "vitest";
import { operationsHistoryAnswer } from "./operations-history";
import type { OperationsAskResult } from "@/lib/ai/runtime/operations-ask";
const fixture = { answer: "Verified sources are shown below.", orders: [{ order_no: "DEMO-101", status: "ASSIGNED", service_type: "Inspection" }],
  excerpts: [{ text: "Disconnect power before inspection.", citation: { title: "Safety guide", sourceLabel: "Manual", section: "Inspection", page: 2 } }],
} as unknown as OperationsAskResult;
describe("Operations public history snapshot", () => {
  it("retains the actual public order evidence and source citation in readable historical text", () => {
    const answer = operationsHistoryAnswer(fixture);
    expect(answer).toContain("DEMO-101 · ASSIGNED · Inspection");
    expect(answer).toContain("Safety guide · Manual · Inspection · page 2");
    expect(answer).toContain("Disconnect power before inspection.");
  });
  it("bounds large evidence and explicitly identifies omitted material", () => {
    const answer = operationsHistoryAnswer({ ...fixture, excerpts: [{ ...fixture.excerpts[0], text: "A".repeat(7000) }] });
    expect(answer.length).toBe(6000); expect(answer).toContain("Additional historical evidence was omitted");
  });
  it("does not invent evidence when runtime abstains", () => {
    expect(operationsHistoryAnswer({ answer: "No answer was verified.", orders: [], excerpts: [] })).toBe("No answer was verified.");
  });
});
