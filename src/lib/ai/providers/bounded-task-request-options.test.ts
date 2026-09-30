import { describe, expect, it } from "vitest";
import { boundedTaskRequestOptions } from "./bounded-task-request-options";

const model = "qwen/qwen3.5-flash-02-23";
describe("bounded task request options", () => {
  it("matches only the normalized gateway hostname and exact configured model", () => {
    expect(boundedTaskRequestOptions("OPENROUTER.AI.", model)).toEqual({ reasoning: { enabled: false } });
  });
  it.each([
    ["provider.example", model], ["openrouter.ai.evil.example", model], ["api.openrouter.ai", model],
    ["openrouter.ai", `${model}:free`], ["openrouter.ai", model.toUpperCase()],
    ["openrouter.ai", "google/gemini-3.1-pro-preview-customtools"],
  ])("leaves %s / %s untouched", (host, otherModel) => {
    expect(boundedTaskRequestOptions(host, otherModel)).toEqual({});
  });
});
