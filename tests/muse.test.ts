// Tạo clip bằng Muse qua HaoHao, thử với một "HaoHao giả": test tự viết tasks.json như HaoHao (không mở HaoHao, không tốn lượt Muse).
// Khớp task với cảnh, nhận clip về đúng cảnh, giữ clip người dùng tự thêm, gửi lại cảnh lỗi, nhận video có sẵn, tự thêm vào hàng chờ dựng.
import { spawnSync } from "node:child_process";
import { cpSync, createReadStream, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MuseShotJob, MuseTask } from "@/lib/muse";
import type { MVResult } from "@/lib/types";
import { waitFor } from "./fakeMuse";

const tmp = mkdtempSync(path.join(tmpdir(), "mvps-muse-"));
for (const f of readdirSync("data").filter((f) => f.endsWith(".json"))) cpSync(path.join("data", f), path.join(tmp, f));
const hao = path.join(tmp, "HaoHao");
const out = path.join(hao, "Videos");
const settingsFile = path.join(tmp, "settings.json");
const baseSettings = { ...JSON.parse(readFileSync(settingsFile, "utf8")), engine: "demo", museMode: "haohao", museDataDir: hao, museAutoRender: true, museAvoid: true };
const setSettings = (patch: Record<string, unknown> = {}) => writeFileSync(settingsFile, JSON.stringify({ ...baseSettings, ...patch }));
setSettings();
process.env.MV_DATA_DIR = tmp;
process.env.MUSE_NO_WATCH = "1"; // không chạy vòng dò nền: test tự gọi museTick từng lượt

let muse: typeof import("@/lib/muse");
let jobs: typeof import("@/lib/museJobs");
let media: typeof import("@/lib/media");
let store: typeof import("@/lib/store");
let mv: MVResult;
let bin: string;
let clip: string;
let song: string;

const stream = (f: string) => Readable.toWeb(createReadStream(f)) as ReadableStream<Uint8Array>;
const make = (args: string[], file: string) => {
  const r = spawnSync(bin, ["-hide_banner", "-loglevel", "error", "-y", ...args, file]);
  if (r.status !== 0) throw new Error(r.stderr.toString());
  return file;
};

// ---------- HaoHao giả ----------

interface FakeTask {
  id: string;
  prompt: string;
  status: MuseTask["status"];
  createdAt: number;
  files?: string[];
  error?: string;
  step?: string;
  held?: boolean;
  ratio?: string;
  kind?: string;
}
let fake: FakeTask[] = [];
let stamp = Date.now() / 1000;
let seq = 0;

/** Ghi tasks.json đúng dạng của HaoHao (thêm các trường HaoHao có mà app không dùng). */
function writeTasks() {
  const full = fake.map((t) => ({
    source: "ui",
    label: t.prompt.slice(0, 60),
    images: [],
    kind: "video",
    expect: 1,
    ratio: "16:9",
    sessionId: "",
    accountId: "default",
    held: false,
    project: "default",
    thread: "",
    pin: "",
    timeoutMin: 10,
    attempts: 0,
    startedAt: 0,
    finishedAt: 0,
    files: [],
    error: "",
    ...t,
  }));
  const file = path.join(hao, "tasks.json");
  writeFileSync(file, JSON.stringify(full));
  utimesSync(file, ++stamp, ++stamp); // mỗi lần ghi một mốc giờ khác (như HaoHao ghi file mới rồi đổi tên)
}

/** HaoHao nhận một prompt dán vào (task mới, đang chờ). */
function haohaoAdd(prompt: string, patch: Partial<FakeTask> = {}): FakeTask {
  const t: FakeTask = { id: `task_${(++seq).toString(16).padStart(16, "0")}`, prompt, status: "queued", createdAt: Date.now(), ...patch };
  fake.unshift(t);
  writeTasks();
  return t;
}

/** Muse làm xong: HaoHao tải video về thư mục lưu. */
function haohaoDone(t: FakeTask) {
  const file = path.join(out, `Muse_${Date.now()}_${seq}.mp4`);
  cpSync(clip, file);
  Object.assign(t, { status: "succeeded", files: [file], step: "" });
  writeTasks();
}

const prompts = (text: string) => text.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean); // cách HaoHao tách ô prompt
const job = async (shot: number): Promise<MuseShotJob> => (await jobs.readMuse()).mvs.find((m) => m.mv_id === mv.id)!.shots.find((s) => s.shot_no === shot)!;
const textOf = (shot: number) => muse.museText(mv.shots.find((s) => s.shot_no === shot)!, { avoid: true });
const enqueued: string[][] = [];
const tick = () => jobs.museTick({ enqueue: async (ids) => void enqueued.push(ids) });

beforeAll(async () => {
  muse = await import("@/lib/muse");
  jobs = await import("@/lib/museJobs");
  media = await import("@/lib/media");
  store = await import("@/lib/store");
  const gen = await import("@/lib/generate");
  bin = (await import("@/lib/ffmpeg")).findFfmpeg().path!;
  mkdirSync(out, { recursive: true });
  writeTasks();
  mv = await gen.generateMV({ id: "1", world_location: "Hollywood Boulevard Summer 1954", theme_code: "T01", outline: "Gặp nhau giữa phố đông" });
  clip = make(["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24:duration=3", "-c:v", "libx264", "-preset", "ultrafast"], path.join(tmp, "clip.mp4"));
  song = make(["-f", "lavfi", "-i", "sine=frequency=440:duration=7", "-c:a", "libmp3lame"], path.join(tmp, "song.mp3"));
}, 120000);

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("chữ gửi Muse + khớp task HaoHao (thuần)", () => {
  const shot = { prompt_en: "Medium shot of {{HE}}\n  dancing   under neon.\n", negative_prompt: "modern cars, smartphones, " };

  it("gom một dòng, ghép Avoid từ negative prompt; dán vào HaoHao tách lại đúng từng prompt", () => {
    expect(muse.museText(shot, { avoid: true })).toBe("Medium shot of {{HE}} dancing under neon. Avoid: modern cars, smartphones.");
    expect(muse.museText(shot, { avoid: false })).toBe("Medium shot of {{HE}} dancing under neon.");
    expect(muse.museText({ ...shot, negative_prompt: "" }, { avoid: true })).toBe("Medium shot of {{HE}} dancing under neon.");
    const texts = ["A one.", "B two. Avoid: x.", "C three."];
    expect(prompts(muse.pasteText(texts))).toEqual(texts);
    expect(muse.pasteText([])).toBe("");
  });

  it("đọc tasks.json: chỉ task video, bỏ mục hỏng; không phải danh sách thì báo lỗi", () => {
    const tasks = muse.parseHaoHaoTasks([
      { id: "task_1", prompt: "p", status: "succeeded", kind: "video", files: ["a.mp4", 3], createdAt: 5 },
      { id: "task_2", prompt: "p", status: "succeeded", kind: "image", files: ["b.png"], createdAt: 6 },
      { id: "task_3", status: "queued" },
      { id: "task_4", prompt: "p", status: "lạ" },
      null,
    ]);
    expect(tasks).toEqual([{ id: "task_1", prompt: "p", status: "succeeded", step: "", error: "", files: ["a.mp4"], ratio: "", held: false, created_at: 5 }]);
    expect(() => muse.parseHaoHaoTasks({ tasks: [] })).toThrow(/không đúng dạng/);
  });

  it("chọn task: chỉ task tạo sau lúc copy, ưu tiên xong > đang làm > lỗi, không phân biệt khoảng trắng", () => {
    const t0 = Date.parse("2026-10-20T10:00:00Z");
    const task = (id: string, status: MuseTask["status"], at: number, prompt = "Hello  world"): MuseTask => ({
      id,
      prompt,
      status,
      step: "",
      error: "",
      files: [],
      ratio: "16:9",
      held: false,
      created_at: t0 + at,
    });
    const j = { text: "Hello world", sent_at: new Date(t0).toISOString() };
    expect(muse.pickTask(j, [task("old", "succeeded", -60000)])).toBeUndefined();
    expect(muse.pickTask(j, [task("a", "failed", 1000), task("b", "processing", 2000)])?.id).toBe("b");
    expect(muse.pickTask(j, [task("a", "succeeded", 1000), task("b", "processing", 2000)])?.id).toBe("a");
    expect(muse.pickTask(j, [task("a", "failed", 1000), task("c", "cancelled", 3000)])?.id).toBe("c");
    expect(muse.pickTask(j, [task("x", "succeeded", 1000, "Other")])).toBeUndefined();
  });

  it("trạng thái cảnh theo task", () => {
    const base: MuseShotJob = { shot_no: 1, text: "t", sent_at: "", status: "waiting" };
    const t: MuseTask = { id: "task_a", prompt: "t", status: "queued", step: "", error: "", files: [], ratio: "16:9", held: true, created_at: 0 };
    expect(muse.advanceJob(base, t).job).toMatchObject({ status: "queued", step: "Chờ bấm Chạy trong HaoHao", task_id: "task_a" });
    expect(muse.advanceJob(base, { ...t, status: "processing", step: "Tải file", ratio: "9:16" }).job).toMatchObject({
      status: "running",
      step: "Tải file",
      message: expect.stringMatching(/9:16/),
    });
    expect(muse.advanceJob(base, { ...t, status: "failed", error: "Quá 30 phút" }).job).toMatchObject({ status: "error", message: "Quá 30 phút" });
    expect(muse.advanceJob(base, { ...t, status: "succeeded" }).importNow?.id).toBe("task_a");
    // Task bị xoá bên HaoHao → quay về chờ dán.
    expect(muse.advanceJob({ ...base, status: "running", task_id: "task_a" }, undefined).job).toMatchObject({ status: "waiting", message: expect.stringMatching(/bị xoá/) });
    // Đưa clip vào lỗi → không thử lại liên tục với cùng task.
    const failed = { ...base, status: "error" as const, task_id: "task_a", import_error_task: "task_a" };
    expect(muse.advanceJob(failed, { ...t, status: "succeeded" }).importNow).toBeUndefined();
    expect(muse.advanceJob({ ...base, status: "done" }, { ...t, status: "failed" }).job.status).toBe("done");
  });
});

describe("HaoHao giả → clip vào đúng cảnh", () => {
  it("gửi 3 cảnh: chữ để dán gồm đúng 3 prompt, cảnh chờ dán", async () => {
    const r = await jobs.sendToMuse([mv.id], { shots: [1, 2, 3] });
    expect(r).toMatchObject({ count: 3, reused: 0, shots: 3, mvs: 1 });
    expect(r.warning).toBeUndefined();
    expect(prompts(r.text)).toEqual([1, 2, 3].map(textOf));
    expect(textOf(1)).toMatch(/ Avoid: .*modern cars/);
    expect((await job(1)).status).toBe("waiting");
    // Bấm tạo lần nữa (cảnh chưa có clip): không gửi lại cảnh đang chờ.
    const again = await jobs.sendToMuse([mv.id], { onlyMissing: true });
    expect(prompts(again.text)).not.toContain(textOf(1));
  });

  it("HaoHao nhận → Muse làm → xong: clip vào đúng cảnh, lỗi hiện lý do", async () => {
    const t1 = haohaoAdd(textOf(1), { status: "processing", step: "Muse đang làm" });
    haohaoAdd(textOf(2), { held: true });
    const t3 = haohaoAdd(textOf(3));
    expect(await tick()).toBe("fast");
    expect(await job(1)).toMatchObject({ status: "running", step: "Muse đang làm", task_id: t1.id });
    expect(await job(2)).toMatchObject({ status: "queued", step: "Chờ bấm Chạy trong HaoHao" });

    Object.assign(t3, { status: "failed", error: "Muse không tạo video." });
    haohaoDone(t1);
    await tick();
    const done = await job(1);
    expect(done).toMatchObject({ status: "done", task_id: t1.id });
    const p = await media.loadProject(mv.id);
    expect(p.clips["1"]).toMatchObject({ file: done.clip_file, name: path.basename(t1.files![0]) });
    expect(p.clips["1"].duration).toBeGreaterThan(2.9);
    expect(p.clips["2"]).toBeUndefined();
    expect(await job(3)).toMatchObject({ status: "error", message: "Muse không tạo video." });
  }, 60000);

  it("cảnh có clip tự thêm sau khi gửi → giữ nguyên, không đè", async () => {
    const mine = (await media.addClip(mv.id, 2, "cua-toi.mp4", stream(clip))).clips["2"].file;
    haohaoDone(fake.find((t) => t.prompt === textOf(2))!);
    await tick();
    expect(await job(2)).toMatchObject({ status: "kept", message: expect.stringMatching(/không đè/) });
    expect((await media.loadProject(mv.id)).clips["2"].file).toBe(mine);
  }, 60000);

  it("gửi lại cảnh lỗi: bỏ qua task lỗi cũ, theo task mới", async () => {
    const r = await jobs.sendToMuse([mv.id], { shots: [3] });
    expect(prompts(r.text)).toEqual([textOf(3)]);
    await tick();
    expect(await job(3)).toMatchObject({ status: "waiting" });
    haohaoDone(haohaoAdd(textOf(3)));
    await tick();
    expect(await job(3)).toMatchObject({ status: "done" });
  }, 60000);

  it("đủ clip + có bài hát → tự thêm vào hàng chờ dựng (một lần)", async () => {
    // Bỏ theo dõi các cảnh chờ dán từ lần bấm thứ hai, rồi tạo nốt các cảnh còn thiếu.
    await jobs.forgetMuse(mv.id, mv.shots.map((s) => s.shot_no).filter((n) => n > 3));
    const r = await jobs.sendToMuse([mv.id], { onlyMissing: true });
    const rest = mv.shots.map((s) => s.shot_no).filter((n) => n > 3);
    expect(r.shots).toBe(rest.length);
    for (const n of rest) haohaoDone(haohaoAdd(textOf(n)));
    await tick();
    expect((await jobs.readMuse()).mvs[0].note).toMatch(/thêm bài hát/);
    expect(enqueued).toEqual([]);

    await media.addAudio(mv.id, "song.mp3", stream(song));
    expect(await tick()).toBeNull();
    expect(enqueued).toEqual([[mv.id]]);
    expect((await jobs.readMuse()).mvs[0]).toMatchObject({ note: expect.stringMatching(/hàng chờ dựng/), queued_at: expect.any(String) });
    await tick();
    expect(enqueued).toHaveLength(1);
  }, 120000);

  it("cảnh mất clip mà HaoHao đã có video cùng prompt → nhận luôn, không dán lại", async () => {
    await media.removeClip(mv.id, 5);
    const r = await jobs.sendToMuse([mv.id], { onlyMissing: true });
    expect(r).toMatchObject({ count: 0, reused: 1, text: "" });
    await tick();
    expect(await job(5)).toMatchObject({ status: "done" });
    expect((await media.loadProject(mv.id)).clips["5"]).toBeDefined();
  }, 60000);

  it("đưa clip vào MV lỗi → Nhận lại clip (không gửi lại, không tốn lượt)", async () => {
    await media.removeClip(mv.id, 7);
    const r = await jobs.sendToMuse([mv.id], { onlyMissing: true });
    expect(r).toMatchObject({ count: 0, reused: 1 });
    const task = fake.find((t) => t.prompt === textOf(7) && t.status === "succeeded")!;
    const file = task.files![0];
    renameSync(file, `${file}.tam`); // file tạm thời không đọc được
    await tick();
    expect(await job(7)).toMatchObject({ status: "error", import_error_task: task.id });
    await tick();
    expect((await job(7)).status).toBe("error"); // không tự thử lại liên tục

    renameSync(`${file}.tam`, file);
    expect(await jobs.reimportMuse(mv.id)).toBe(1);
    await tick();
    expect(await job(7)).toMatchObject({ status: "done" });
    expect((await media.loadProject(mv.id)).clips["7"]).toBeDefined();
    expect(fake.filter((t) => t.prompt === textOf(7))).toHaveLength(1); // không có task mới bên HaoHao
  }, 60000);

  it("MV bị xoá → thôi theo dõi; không thấy HaoHao → báo rõ", async () => {
    const gen = await import("@/lib/generate");
    const other = await gen.generateMV({ id: "2", world_location: "Santa Monica Pier Summer 1955", theme_code: "T01", outline: "Hẹn hò" });
    await jobs.sendToMuse([other.id], { shots: [1] });
    await store.deleteMV(other.id);
    await tick();
    expect((await jobs.readMuse()).mvs.map((m) => m.mv_id)).toEqual([mv.id]);

    const { haohaoInfo, readHaoHaoTasks } = await import("@/lib/haohao");
    const missing = path.join(tmp, "khong-co");
    expect(await haohaoInfo(missing)).toMatchObject({ found: false, tasks: null });
    await expect(readHaoHaoTasks(missing)).rejects.toThrow(/Không thấy tasks.json/);
    const info = await haohaoInfo(hao);
    expect(info).toMatchObject({ found: true, outputIsDefault: true });
    expect(info.tasks).toBeGreaterThan(0);
  }, 60000);
});

describe("Cổng Muse (gửi tự động) → clip vào đúng cảnh", () => {
  it("chưa mở cổng → báo rõ, không ghi nhận cảnh nào", async () => {
    setSettings({ museMode: "gateway", museGatewayUrl: "http://127.0.0.1:9" });
    const gen = await import("@/lib/generate");
    const other = await gen.generateMV({ id: "3", world_location: "Times Square Winter 1956", theme_code: "T01", outline: "Gặp lại" });
    await expect(jobs.sendToMuse([other.id], { shots: [1] })).rejects.toThrow(/Chưa kết nối được Cổng Muse/);
    expect((await jobs.readMuse()).mvs.some((m) => m.mv_id === other.id)).toBe(false);
  });

  it("app tự gửi cảnh (kèm ảnh nhân vật) → Muse giả làm xong → clip vào MV", async () => {
    const { createGateway } = await import("../gateway/server.ts");
    const { FakeMuse, FAST } = await import("./fakeMuse");
    const gen = await import("@/lib/generate");
    const fake = new FakeMuse(readFileSync(clip));
    const gw = await createGateway({ dir: path.join(tmp, "gateway"), port: 0, page: fake, worker: FAST });
    try {
      setSettings({ museMode: "gateway", museGatewayUrl: gw.url });
      const m = await gen.generateMV({ id: "4", world_location: "Route 66 Summer 1957", theme_code: "T01", outline: "Đi xe dọc đường 66" });
      // Ảnh tham chiếu của nhân vật có trong cảnh đầu tiên.
      const s1 = m.shots[0];
      const who = s1.characters_in_shot[0] ?? m.character_bible.characters[0].id;
      if (!s1.characters_in_shot.length) s1.characters_in_shot.push(who);
      await store.saveMV(m);
      mkdirSync(path.join(store.UPLOAD_DIR(), m.id), { recursive: true });
      writeFileSync(path.join(store.UPLOAD_DIR(), m.id, "ref.png"), "png-bytes");
      await gen.setReferenceImages(m.id, who, [`data/uploads/${m.id}/ref.png`]);

      const r = await jobs.sendToMuse([m.id], { shots: [s1.shot_no, m.shots[1].shot_no] });
      expect(r).toMatchObject({ sent: true, text: "", count: 2, failed: 0 });
      // Cổng làm lần lượt: gửi cảnh 1, chờ xong rồi mới gửi cảnh 2.
      await waitFor(() => fake.sent.length === 1, 5000, "cổng gửi lệnh đầu");
      expect(fake.sent[0].text).toBe(`Tạo video · tỷ lệ 16:9 ngang\n${muse.museText(s1, { avoid: true })}`);
      expect(fake.sent[0].atts).toHaveLength(1);
      expect(Buffer.from(fake.sent[0].atts[0].dataBase64, "base64").toString()).toBe("png-bytes");

      await tick();
      const state = (await jobs.readMuse()).mvs.find((x) => x.mv_id === m.id)!;
      expect(state.shots.map((s) => [s.submitted, Boolean(s.task_id), s.status])).toEqual([
        [true, true, "running"],
        [true, true, "queued"],
      ]);

      fake.finish(1);
      await waitFor(() => fake.sent.length === 2, 5000, "cổng gửi lệnh thứ hai");
      fake.finish(2);
      await waitFor(async () => gw.store.list("succeeded").length === 2, 5000, "cổng tải xong");
      await tick();
      const after = (await jobs.readMuse()).mvs.find((x) => x.mv_id === m.id)!;
      expect(after.shots.map((s) => s.status)).toEqual(["done", "done"]);
      const p = await media.loadProject(m.id);
      expect(p.clips[String(s1.shot_no)].duration).toBeGreaterThan(2.9);
      expect(p.clips[String(m.shots[1].shot_no)]).toBeDefined();

      // Muse làm xong nhưng cổng tưởng lỗi → "Kiểm tra lại" lấy được video, không gửi lại.
      const s3 = m.shots[2];
      await jobs.sendToMuse([m.id], { shots: [s3.shot_no] });
      await waitFor(() => fake.sent.length === 3, 5000, "gửi cảnh 3");
      fake.finish(3, false);
      await waitFor(async () => gw.store.list("failed").length === 1, 5000, "cổng báo lỗi");
      await tick();
      expect((await jobs.readMuse()).mvs.find((x) => x.mv_id === m.id)!.shots.find((s) => s.shot_no === s3.shot_no)).toMatchObject({ status: "error" });
      fake.sessions.get("sess_3")!.ok = true;
      expect(await jobs.recheckMuse(m.id)).toBe(1);
      await waitFor(async () => gw.store.list("succeeded").length === 3, 5000, "kiểm tra lại xong");
      await tick();
      expect((await jobs.readMuse()).mvs.find((x) => x.mv_id === m.id)!.shots.find((s) => s.shot_no === s3.shot_no)).toMatchObject({ status: "done" });
      expect(fake.sent).toHaveLength(3);

      // Bấm "gửi" lại (cảnh chưa có clip): các cảnh đã xong không bị gửi lại.
      const rest = await jobs.sendToMuse([m.id], { onlyMissing: true });
      expect(rest.count).toBe(new Set(m.shots.slice(3).map((s) => muse.museText(s, { avoid: true }))).size);
      expect(gw.store.list().filter((t) => t.prompt === muse.museText(s1, { avoid: true }))).toHaveLength(1);
    } finally {
      await gw.close();
      setSettings();
    }
  }, 60000);
});
