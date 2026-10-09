import { describe, expect, it } from "vitest";
import { isStringArray, parseJsonText } from "@/lib/openai/parse-json-text";

describe("parseJsonText", () => {
  const validate = (v: unknown) => v as { a: number };

  it("parses trimmed JSON and runs the validator", () => {
    expect(parseJsonText('  {"a":1} ', "trade recap", validate)).toEqual({ a: 1 });
  });

  it("rejects empty content with the label", () => {
    expect(() => parseJsonText("  ", "trade recap", validate)).toThrow(
      "OpenAI returned an empty trade recap.",
    );
  });

  it("picks the right article for unreadable JSON", () => {
    expect(() => parseJsonText("{", "explanation", validate)).toThrow(
      "OpenAI returned an explanation we could not read. Try again.",
    );
    expect(() => parseJsonText("{", "morning brief", validate)).toThrow(
      "OpenAI returned a morning brief we could not read. Try again.",
    );
  });

  it("uses a custom unreadable message", () => {
    expect(() => parseJsonText("{", "brief", validate, "custom")).toThrow("custom");
  });
});

describe("isStringArray", () => {
  it("accepts only arrays of strings", () => {
    expect(isStringArray(["a", "b"])).toBe(true);
    expect(isStringArray(["a", 1])).toBe(false);
    expect(isStringArray("a")).toBe(false);
  });
});
