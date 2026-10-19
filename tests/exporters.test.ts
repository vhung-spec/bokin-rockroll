import { describe, expect, it } from "vitest";
import { allPrompts } from "@/lib/exporters";
import type { MVResult } from "@/lib/types";

const mv = (prompts: string[]) => ({ shots: prompts.map((p) => ({ prompt_en: p })) }) as unknown as MVResult;

describe("allPrompts", () => {
  const mvs = [mv(["Prompt A1.", "Prompt A2\nline two."]), mv(["Prompt B1."])];

  it("mỗi dòng một prompt", () => {
    expect(allPrompts(mvs)).toBe("Prompt A1.\nPrompt A2 line two.\nPrompt B1.");
  });

  it("cách nhau một dòng trống, không có dòng trống thừa", () => {
    const out = allPrompts(mvs, { blankLine: true });
    expect(out).toBe("Prompt A1.\n\nPrompt A2 line two.\n\nPrompt B1.\n");
    expect(out.split(/\n\s*\n/).map((x) => x.trim())).toEqual(["Prompt A1.", "Prompt A2 line two.", "Prompt B1."]);
  });
});

describe("cost", async () => {
  const { callCost, estimateCost, formatMoney, formatVnd } = await import("@/lib/cost");
  it("tính tiền theo bảng giá, gồm cache", () => {
    const price = { input: 2, output: 10, cache_write: 2.5, cache_read: 0.2 };
    expect(callCost({ input_tokens: 1_000_000, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, price)).toBe(2);
    expect(callCost({ input_tokens: 0, output_tokens: 100_000, cache_creation_input_tokens: 400_000, cache_read_input_tokens: 1_000_000 }, price)).toBeCloseTo(1 + 1 + 0.2);
    expect(callCost({ input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, undefined)).toBeNull();
  });
  it("ước tính 20 cảnh Sonnet ở mức khoảng $0.08–0.20", () => {
    const r = estimateCost({ input: 2, output: 10, cache_write: 2.5, cache_read: 0.2 }, 20, "medium")!;
    expect(r.low).toBeGreaterThan(0.05);
    expect(r.high).toBeLessThan(0.25);
    expect(r.low).toBeLessThan(r.high);
  });
  it("định dạng $ và đ", () => {
    expect(formatVnd(0.12, 26000)).toBe("3.100 đ");
    expect(formatMoney(0.1234, 26000)).toBe("$0.123 (≈ 3.200 đ)");
  });
});
