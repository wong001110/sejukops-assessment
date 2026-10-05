import { describe, expect, it } from "vitest";
import { knowledgeQueryCandidates } from "./knowledge-query-candidates";

describe("literal knowledge query candidates", () => {
  it.each([
    ["What does AC-102 require before inspection?", "AC-102"],
    ["FILTER-E2E-42：清洁虚构滤网前应做什么？", "FILTER-E2E-42"],
    ["设备QX_731和R2.1有哪些要求？", "QX_731"],
  ])("prioritizes the complete original identifier in %s", (question, identifier) => {
    const candidates = knowledgeQueryCandidates(question);
    expect(candidates[0]).toBe(identifier);
    expect(candidates).toContain(question);
    expect(candidates.length).toBeLessThanOrEqual(8);
    expect(new Set(candidates).size).toBe(candidates.length);
    for (const value of candidates) {
      expect(question.includes(value)).toBe(true);
      expect(value.length).toBeGreaterThanOrEqual(2);
      expect(value.length).toBeLessThanOrEqual(120);
    }
  });

  it("extracts punctuation chunks but does not invent semantic Chinese keywords", () => {
    expect(knowledgeQueryCandidates("清洁虚构滤网，前应做什么？请给出处。"))
      .toEqual(["清洁虚构滤网，前应做什么？请给出处。", "清洁虚构滤网", "前应做什么", "请给出处"]);
    expect(knowledgeQueryCandidates("请问清洁虚构滤网前应做什么？"))
      .toEqual(["请问清洁虚构滤网前应做什么？", "请问清洁虚构滤网前应做什么"]);
  });

  it("caps candidates at eight while reserving the full bounded input", () => {
    const question = `${Array.from({ length: 12 }, (_, i) => `AC-${i}`).join(" ")} ${"中".repeat(58)}`;
    expect(question).toHaveLength(120);
    const candidates = knowledgeQueryCandidates(question);
    expect(candidates).toHaveLength(8);
    expect(candidates.slice(0, 7)).toEqual(Array.from({ length: 7 }, (_, i) => `AC-${i}`));
    expect(candidates[7]).toBe(question);
  });

  it("deduplicates original spans and exposes no index for too-short or oversized questions", () => {
    expect(knowledgeQueryCandidates("AC-102 AC-102, AC-102"))
      .toEqual(["AC-102", "AC-102 AC-102, AC-102"]);
    expect(knowledgeQueryCandidates("中")).toEqual([]);
    expect(knowledgeQueryCandidates("中".repeat(121))).toEqual([]);
    expect(knowledgeQueryCandidates("  QX-731  ")).toEqual(["QX-731"]);
  });
});
