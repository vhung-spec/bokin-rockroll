import { describe, expect, it } from "vitest";
import { assemblePrompt, coreBudget, expandCharacters, forceFit, joinNegative, placeholdersIn } from "@/lib/assemble";
import type { CharacterBible, VideoModelProfile } from "@/lib/types";

const bible: CharacterBible = {
  characters: [
    { id: "HE", role: "male lead", description: "an early-20s man with a glossy black pompadour, white T-shirt under a red varsity jacket, cuffed blue jeans" },
    { id: "SHE", role: "female lead", description: "an early-20s woman with platinum-blonde victory-roll curls, mint-green polka-dot halter sundress" },
  ],
};
const STYLE = "Shot on 35mm Kodachrome film, 1950s America, warm saturated pastel colors, soft film grain, 24fps";

describe("assemblePrompt", () => {
  it("thay placeholder bằng mô tả nguyên văn và thêm style ở cuối", () => {
    const p = assemblePrompt("Medium tracking shot, {{HE}} strolls past a newsstand, slow dolly [STYLE]", { bible, styleText: STYLE });
    expect(p).toBe(`Medium tracking shot, ${bible.characters[0].description} strolls past a newsstand, slow dolly. ${STYLE}.`);
    expect(p.endsWith(`${STYLE}.`)).toBe(true);
  });

  it("thêm dòng Audio khi công cụ hỗ trợ", () => {
    const p = assemblePrompt("Wide shot of a pier", { bible, styleText: STYLE, audio: "doo-wop harmonies, seagulls", supportsAudio: true });
    expect(p.endsWith("Audio: doo-wop harmonies, seagulls.")).toBe(true);
    expect(assemblePrompt("Wide shot", { bible, styleText: STYLE, audio: "x", supportsAudio: false })).not.toContain("Audio");
  });

  it("placeholdersIn / expandCharacters", () => {
    expect(placeholdersIn("{{HE}} and {{ she }} dance, {{HE}} spins")).toEqual(["HE", "SHE"]);
    expect(expandCharacters("{{SHE}} smiles", bible)).toBe(`${bible.characters[1].description} smiles`);
  });
});

describe("độ dài", () => {
  const profile: VideoModelProfile = {
    name: "Runway",
    max_prompt_chars: 400,
    target_prompt_chars: 350,
    default_clip_len: 10,
    clip_lengths: [5, 10],
    supports_audio: false,
    supports_negative_prompt: false,
    prompt_style: "",
  };

  it("coreBudget trừ đi nhân vật và style", () => {
    const b = coreBudget(["HE"], bible, STYLE, profile);
    expect(b).toBe(Math.max(120, 400 - bible.characters[0].description.length - STYLE.length - 10));
  });

  it("forceFit cắt phần mô tả cảnh nhưng giữ nhân vật và style", () => {
    const core =
      "Close-up of {{SHE}} turning toward the camera, her curls catching the sunlight, the crowd behind her blurring into soft shapes, flashbulbs popping, a newsboy shouting, palm fronds swaying, a streetcar bell ringing, pigeons scattering into the sky, a vendor selling oranges, a convertible honking twice, children chasing a dog, a band playing on a corner";
    const r = forceFit({ prompt_core: core, audio: null }, { bible, styleText: STYLE, shortStyleText: "35mm Kodachrome, 1950s, 24fps", maxChars: 400 });
    expect(r.prompt.length).toBeLessThanOrEqual(400);
    expect(r.truncated).toBe(true);
    expect(r.prompt).toContain(bible.characters[1].description);
    expect(r.prompt.endsWith("35mm Kodachrome, 1950s, 24fps.")).toBe(true);
  });
});

describe("joinNegative", () => {
  it("gộp và bỏ trùng", () => {
    expect(joinNegative(["text", "watermark"], "Text, extra fingers", null)).toBe("text, watermark, extra fingers");
  });
});
