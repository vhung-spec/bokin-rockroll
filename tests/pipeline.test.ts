// Chạy toàn bộ pipeline ở chế độ demo với 5 dòng ví dụ của spec (mục 2.1).
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SAMPLE_PIPE } from "./parser.test";
import type { MVResult } from "@/lib/types";

const tmp = mkdtempSync(path.join(tmpdir(), "mvps-"));
for (const f of readdirSync("data").filter((f) => f.endsWith(".json"))) cpSync(path.join("data", f), path.join(tmp, f));
process.env.MV_DATA_DIR = tmp;
process.env.MOCK_LLM = "1";

type Gen = typeof import("@/lib/generate");
type Store = typeof import("@/lib/store");
let gen: Gen;
let store: Store;
const results: MVResult[] = [];

beforeAll(async () => {
  gen = await import("@/lib/generate");
  store = await import("@/lib/store");
  const { parseIdeaTable } = await import("@/lib/parser");
  const ideas = parseIdeaTable(SAMPLE_PIPE, { series: "1–50 · California – Las Vegas – Route 66 – New York" }).rows;
  for (const idea of ideas) results.push(await gen.generateMV(idea));
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("pipeline (demo)", () => {
  it("dòng 1: 15–20 cảnh (theo cài đặt), nhân vật nhất quán, không sai niên đại", () => {
    const mv = results[0];
    expect(mv.generator).toBe("mock");
    expect(mv.shots.length).toBeGreaterThanOrEqual(15);
    expect(mv.shots.length).toBeLessThanOrEqual(20);
    expect(mv.editing_notes.some((n) => n.section === "Lặp cảnh")).toBe(true);
    for (const r of results) expect(r.shots.length).toBeLessThanOrEqual(20);
    expect(mv.location_key).toBe("Hollywood Boulevard");
    expect(mv.year).toBe(1954);
    const he = mv.character_bible.characters.find((c) => c.id === "HE")!;
    const withHe = mv.shots.filter((s) => s.characters_in_shot.includes("HE"));
    expect(withHe.length).toBeGreaterThan(5);
    for (const s of withHe) expect(s.prompt_en).toContain(he.description);
    const errors = mv.issues.filter((i) => i.severity === "error");
    expect(errors).toEqual([]);
  });

  it("mọi prompt: tiếng Anh, có style preset ở cuối, trong giới hạn độ dài", async () => {
    const libs = await store.readLibraries();
    for (const mv of results) {
      const limit = libs.videoModels[mv.video_model].max_prompt_chars;
      for (const s of mv.shots) {
        expect(s.prompt_en.length).toBeLessThanOrEqual(limit);
        expect(s.prompt_en).toContain(mv.style_text);
        expect(s.prompt_en).not.toMatch(/\{\{|\[STYLE\]/);
        expect(s.prompt_en).not.toMatch(/[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữự]/i);
      }
    }
  });

  it("mỗi chorus có cảnh chuyển động, signature shots ≥ 2", () => {
    for (const mv of results) {
      for (const sec of ["Chorus 1", "Chorus 2", "Final chorus"]) {
        expect(mv.shots.some((s) => s.section === sec && s.is_motion)).toBe(true);
      }
      expect(mv.shots.filter((s) => s.signature_shot).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("drive-in 1956 khớp đúng địa điểm, pier không có vòng đu quay", () => {
    expect(results[1].location_key).toBe("Hollywood Drive-In");
    expect(results[4].location_key).toBe("Santa Monica Pier");
    expect(results[4].shots.some((s) => /ferris wheel/i.test(s.prompt_en))).toBe(false);
  });

  it("xuất XLSX: mỗi MV một sheet + sheet Tổng quan", async () => {
    const { buildWorkbook } = await import("@/lib/xlsx");
    const buf = await buildWorkbook(results);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      "Tổng quan",
      "1 Hollywood Boulevard Summer 19",
      "2 Hollywood Drive-In Night 1956",
      "3 Sunset Boulevard Rock & Roll",
      "4 Hollywood Summer Nights 1958",
      "5 Santa Monica Pier Summer 1954",
    ]);
    const sheet = wb.worksheets[1];
    expect(sheet.rowCount).toBe(results[0].shots.length + 1);
    expect(String(sheet.getRow(2).getCell(1).value)).toBe("1");
  });

  it("lưu lịch sử, sinh lại cảnh, sửa tay, đổi Character Bible", async () => {
    const all = await store.listMVs();
    expect(all).toHaveLength(5);
    const mv = results[0];
    const regen = await gen.regenerateShot(mv.id, 5, "góc máy khác");
    expect(regen.shots[4].prompt_core).not.toBe("");
    expect(regen.shots.length).toBe(mv.shots.length);

    const edited = await gen.updateShot(mv.id, 3, { prompt_en: "Wide shot of a quiet street at dawn. " + mv.style_text });
    expect(edited.shots[2].edited).toBe(true);

    const newHe = "a 23-year-old man with a wavy chestnut pompadour, wearing a navy cardigan over a white shirt and grey slacks, horn-rimmed glasses";
    const chars = edited.character_bible.characters.map((c) => (c.id === "HE" ? { ...c, description: newHe } : c));
    const rebibled = await gen.updateBible(mv.id, chars);
    const heShots = rebibled.shots.filter((s) => s.characters_in_shot.includes("HE") && !s.edited);
    expect(heShots.length).toBeGreaterThan(0);
    for (const s of heShots) expect(s.prompt_en).toContain(newHe);
    // cảnh đã sửa tay giữ nguyên
    expect(rebibled.shots[2].prompt_en).toContain("quiet street at dawn");
  });

  it("địa điểm mới được tự sinh và đánh dấu auto_generated", async () => {
    const mv = await gen.generateMV({ id: "99", world_location: "Albuquerque Rodeo 1957", theme_code: "T04", outline: "Gặp nhau ở rodeo" });
    expect(mv.location.auto_generated).toBe(true);
    const libs = await store.readLibraries();
    expect(libs.locations["Albuquerque Rodeo"]?.auto_generated).toBe(true);
  });

  it("cặp đôi cố định cho cả series", async () => {
    const settings = await store.readSettings();
    await store.writeSettings({ ...settings, fixedCouple: true });
    const a = await gen.generateMV({ id: "10", world_location: "Times Square Winter 1955", theme_code: "T03", outline: "Hẹn hò", series: "S2" });
    const b = await gen.generateMV({ id: "11", world_location: "Coney Island Summer 1956", theme_code: "T04", outline: "Vui chơi", series: "S2" });
    expect(a.character_bible.characters.map((c) => c.description)).toEqual(b.character_bible.characters.map((c) => c.description));
    const couples = await store.readCouples();
    expect(couples["S2"].characters).toHaveLength(2);
    await store.writeSettings({ ...settings, fixedCouple: false });
  });
});
