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
