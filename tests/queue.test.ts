// Hàng chờ dựng: thiết lập chung chọn một lần, dựng lần lượt nhiều MV, bỏ qua MV chưa đủ nhạc / clip.
import { spawnSync } from "node:child_process";
import { cpSync, createReadStream, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MVResult } from "@/lib/types";

const tmp = mkdtempSync(path.join(tmpdir(), "mvps-queue-"));
for (const f of readdirSync("data").filter((f) => f.endsWith(".json"))) cpSync(path.join("data", f), path.join(tmp, f));
const settingsFile = path.join(tmp, "settings.json");
writeFileSync(settingsFile, JSON.stringify({ ...JSON.parse(readFileSync(settingsFile, "utf8")), engine: "demo" }));
process.env.MV_DATA_DIR = tmp;

let media: typeof import("@/lib/media");
let queue: typeof import("@/lib/queue");
let edit: typeof import("@/lib/edit");
let mvs: MVResult[];
let bin: string;
const src = path.join(tmp, "src");
const stream = (f: string) => Readable.toWeb(createReadStream(f)) as ReadableStream<Uint8Array>;
const make = (args: string[], out: string) => {
  const r = spawnSync(bin, ["-hide_banner", "-loglevel", "error", "-y", ...args, out]);
  if (r.status !== 0) throw new Error(r.stderr.toString());
  return out;
};

beforeAll(async () => {
  media = await import("@/lib/media");
  queue = await import("@/lib/queue");
  edit = await import("@/lib/edit");
  const gen = await import("@/lib/generate");
  bin = (await import("@/lib/ffmpeg")).findFfmpeg().path!;
  mkdirSync(src, { recursive: true });
  mvs = [];
  for (const [i, loc] of ["Hollywood Boulevard Summer 1954", "Santa Monica Pier Summer 1955", "Times Square Winter 1956"].entries()) {
    mvs.push(await gen.generateMV({ id: String(i + 1), world_location: loc, theme_code: "T01", outline: "Gặp nhau" }));
  }
  const song = make(["-f", "lavfi", "-i", "sine=frequency=440:duration=7", "-c:a", "libmp3lame"], path.join(src, "song.mp3"));
  const clip = make(["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24:duration=3", "-c:v", "libx264", "-preset", "ultrafast"], path.join(src, "c.mp4"));
  // MV 1 và 3 đủ nhạc + clip; MV 2 chỉ có nhạc.
  for (const mv of [mvs[0], mvs[2]]) {
    await media.addAudio(mv.id, "song.mp3", stream(song));
    await media.addClip(mv.id, mv.shots[0].shot_no, "c1.mp4", stream(clip));
    await media.addClip(mv.id, mv.shots[1].shot_no, "c2.mp4", stream(clip));
  }
  await media.addAudio(mvs[1].id, "song.mp3", stream(song));
}, 120000);

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("thiết lập chung + hàng chờ dựng", () => {
  it("thiết lập chung áp cho mọi MV, mốc đoạn vẫn riêng từng bài", () => {
    const own = {
      mv_id: "mv_x",
      audio: null,
      clips: {},
      logo: null,
      font: null,
      options: { ...edit.DEFAULT_EDIT_OPTIONS, size: "1080p" as const, sectionStarts: [0, 5] },
      renders: [],
      updated_at: "",
    };
    const shared = { options: { ...edit.DEFAULT_EDIT_OPTIONS, size: "720p" as const, quality: "fast" as const }, logo: { file: "logo-a.png", name: "l.png", size: 1, duration: 0, uploaded_at: "" }, font: null };
    const eff = edit.applyShared(own, shared);
    expect(eff.options.size).toBe("720p");
    expect(eff.options.quality).toBe("fast");
    expect(eff.options.sectionStarts).toEqual([0, 5]);
    expect(eff.logo).toMatchObject({ file: "logo-a.png", owner: "_shared" });
  });

  it("dựng lần lượt các MV đã đủ nhạc + clip, bỏ qua MV thiếu clip", async () => {
    const shared = await media.loadProject("_shared");
    await media.setOptions("_shared", { ...shared.options, size: "720p", quality: "fast", fadeIn: 0.5, fadeOut: 0.5 });
    const logo = make(["-f", "lavfi", "-i", "color=c=red:s=64x64", "-frames:v", "1"], path.join(src, "logo.png"));
    await media.addAsset("_shared", "logo", "logo.png", stream(logo));

    expect(await queue.addToQueue(mvs.map((m) => m.id))).toBe(3);
    expect(await queue.addToQueue([mvs[0].id])).toBe(0); // đã có trong hàng chờ
    await queue.startQueue();
    await queue.idle();

    const q = await queue.readQueue();
    expect(q.running).toBe(false);
    expect(q.items.map((i) => i.status)).toEqual(["done", "skipped", "done"]);
    expect(q.items[1].message).toMatch(/clip/);
    for (const i of [0, 2]) {
      const p = await media.loadProject(mvs[i].id);
      expect(p.renders).toHaveLength(1);
      expect(p.renders[0]).toMatchObject({ file: q.items[i].output, resolution: "1280x720", quality: "fast", branding: { logo: true, intro: false } });
      expect(p.renders[0].verification?.passed).toBe(true);
    }

    // Thêm clip cho MV 2 rồi dựng lại riêng mục bị bỏ qua.
    const clip = path.join(src, "c.mp4");
    await media.addClip(mvs[1].id, mvs[1].shots[0].shot_no, "c.mp4", stream(clip));
    await queue.retryItem(q.items[1].id);
    await queue.startQueue();
    await queue.idle();
    expect((await queue.readQueue()).items.map((i) => i.status)).toEqual(["done", "done", "done"]);
    await queue.clearFinished();
    expect((await queue.readQueue()).items).toEqual([]);
  }, 300000);

  it("tạm dừng: dựng xong MV hiện tại rồi dừng; huỷ thì MV đang dựng bị huỷ", async () => {
    await queue.addToQueue(mvs.map((m) => m.id));
    await queue.startQueue();
    await queue.pauseQueue();
    await queue.idle();
    let q = await queue.readQueue();
    expect(q.items.filter((i) => i.status === "done")).toHaveLength(1);
    expect(q.items.filter((i) => i.status === "waiting")).toHaveLength(2);

    await queue.startQueue();
    await new Promise((r) => setTimeout(r, 300));
    await queue.cancelCurrent();
    await queue.idle();
    q = await queue.readQueue();
    expect(q.running).toBe(false);
    expect(q.items.map((i) => i.status)).toEqual(["done", "cancelled", "waiting"]);
    await expect(queue.removeFromQueue(q.items[2].id)).resolves.toBeUndefined();
  }, 300000);
});
