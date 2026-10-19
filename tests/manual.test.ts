// Chế độ claude.ai (copy – dán): bản nháp → yêu cầu → câu trả lời dán tay → MV.
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GenContext } from "@/lib/prompts";
import type { IdeaRow } from "@/lib/types";

const tmp = mkdtempSync(path.join(tmpdir(), "mvps-manual-"));
for (const f of readdirSync("data").filter((f) => f.endsWith(".json"))) cpSync(path.join("data", f), path.join(tmp, f));
const settingsFile = path.join(tmp, "settings.json");
const settings = JSON.parse(readFileSync(settingsFile, "utf8"));
writeFileSync(settingsFile, JSON.stringify({ ...settings, engine: "auto", fixedCouple: true }));
process.env.MV_DATA_DIR = tmp;
delete process.env.MOCK_LLM;
delete process.env.ANTHROPIC_API_KEY;

type Gen = typeof import("@/lib/generate");
let gen: Gen;
let store: typeof import("@/lib/store");
let mock: typeof import("@/lib/mock");
let manual: typeof import("@/lib/manual");

const idea = (id: string, world_location: string): IdeaRow => ({ id, world_location, theme_code: "T01", outline: "Gặp nhau giữa phố đông", series: "S1" });

/** Câu trả lời giả của claude.ai: JSON trong khối ```json, kèm chữ thừa và thiếu vài trường. */
async function fakeAnswer(draftId: string, dropFields = true) {
  const d = (await store.loadDraft(draftId))!;
  const raw = mock.mockGenerate(d.ctx as GenContext) as unknown as Record<string, unknown>;
  if (dropFields) {
    raw.shots = (raw.shots as Record<string, unknown>[]).map(({ negative_extra, audio, ...s }) => s);
    delete raw.story_arc;
  }
  return `Here is the JSON you asked for:\n\n\`\`\`json\n${JSON.stringify(raw, null, 2)}\n\`\`\`\nLet me know if you need changes.`;
}

beforeAll(async () => {
  gen = await import("@/lib/generate");
  store = await import("@/lib/store");
  mock = await import("@/lib/mock");
  manual = await import("@/lib/manual");
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("chế độ claude.ai", () => {
  it("không có API key + engine auto → manual", async () => {
    expect(gen.generationMode(await store.readSettings())).toBe("manual");
    await expect(gen.generateMV(idea("x", "Hollywood Boulevard 1954"))).rejects.toThrow(/claude\.ai/);
  });

  it("bản nháp → yêu cầu → câu trả lời → MV; cặp đôi series được lưu từ MV đầu", async () => {
    const [d1, d2] = await gen.createDrafts([idea("1", "Hollywood Boulevard Summer 1954"), idea("2", "Santa Monica Pier Summer 1954")]);
    expect(await store.listDrafts()).toHaveLength(2);

    await expect(gen.completeDraft(d1.id, "{}")).rejects.toThrow(/Copy yêu cầu/);

    const { prompt } = await gen.buildDraftPrompt(d1.id);
    expect(prompt).toContain("music-video director");
    expect(prompt).toContain("RESPONSE FORMAT");
    expect(prompt).toMatch(/produce exactly (1[5-9]|20) shots/);
    expect(prompt).toContain("JSON Schema:");
    expect(prompt).not.toContain("CHARACTER BIBLE (fixed");

    const mv1 = await gen.completeDraft(d1.id, await fakeAnswer(d1.id));
    expect(mv1.generator).toBe("manual");
    expect(mv1.model).toBe("claude.ai");
    expect(mv1.shots.length).toBe(mv1.structure.total_shots);
    expect(mv1.usage?.cost_usd ?? 0).toBe(0);
    expect(mv1.issues.filter((i) => i.severity === "error")).toEqual([]);
    for (const s of mv1.shots) expect(s.prompt_en).toContain(mv1.style_text);
    expect(await store.loadDraft(d1.id)).toBeNull();

    const couples = await store.readCouples();
    expect(couples.S1.characters.map((c) => c.description)).toEqual(mv1.character_bible.characters.slice(0, 2).map((c) => c.description));

    // MV thứ hai của series dùng lại cặp đôi đó
    const { prompt: p2 } = await gen.buildDraftPrompt(d2.id);
    expect(p2).toContain("CHARACTER BIBLE (fixed");
    expect(p2).toContain(mv1.character_bible.characters[0].description);
    const mv2 = await gen.completeDraft(d2.id, await fakeAnswer(d2.id));
    expect(mv2.character_bible.characters[0].description).toBe(mv1.character_bible.characters[0].description);
  });

  it("câu trả lời thiếu cảnh vẫn ghép được, có cảnh báo", async () => {
    const [d] = await gen.createDrafts([idea("3", "Times Square Winter 1955")]);
    await gen.buildDraftPrompt(d.id);
    const full = manual.extractJson(await fakeAnswer(d.id, false)) as { shots: unknown[] };
    full.shots = full.shots.slice(0, 6);
    const mv = await gen.completeDraft(d.id, JSON.stringify(full));
    expect(mv.shots.length).toBe(mv.structure.total_shots);
    expect(mv.generation_notes.some((n) => /6\/\d+ cảnh/.test(n.message_vi))).toBe(true);
  });

  it("sinh lại một cảnh bằng copy – dán", async () => {
    const [d] = await gen.createDrafts([idea("4", "Coney Island Summer 1956")]);
    await gen.buildDraftPrompt(d.id);
    const mv = await gen.completeDraft(d.id, await fakeAnswer(d.id));
    const prompt = await gen.shotRegenManualPrompt(mv.id, 3, "góc máy thấp");
    expect(prompt).toContain("REWRITE ONE SHOT");
    expect(prompt).toContain("góc máy thấp");
    const answer = '```json\n{"shot": {"shot_no": 3, "shot_size": "wide", "camera": "low-angle dolly", "characters_in_shot": ["HE"], "description_vi": "Góc thấp", "prompt_core": "Wide low-angle shot, {{HE}} leaps onto the boardwalk railing, arms wide, slow dolly, joyful", "transition_to_next": "whip pan", "signature_shot": null, "is_motion": true,}}\n```';
    const updated = await gen.applyShotAnswer(mv.id, 3, answer);
    expect(updated.shots[2].prompt_core).toContain("leaps onto the boardwalk railing");
    expect(updated.shots[2].prompt_en).toContain(updated.character_bible.characters[0].description);
  });
});

describe("extractJson / parseAnswer", () => {
  it("báo lỗi dễ hiểu khi không có JSON", () => {
    expect(() => manual.extractJson("Xin lỗi, tôi không thể…")).toThrow(/Không tìm thấy JSON/);
    expect(() => manual.extractJson('{"a": 1, "b": ')).toThrow(/bị cắt giữa chừng|JSON không hợp lệ|Không tìm thấy/);
  });
  it("bỏ qua dấu phẩy thừa và chữ ngoài khối code", () => {
    expect(manual.extractJson('Sure!\n```json\n{"a": [1, 2,], "b": {"c": 3,},}\n```')).toEqual({ a: [1, 2], b: { c: 3 } });
  });
});
