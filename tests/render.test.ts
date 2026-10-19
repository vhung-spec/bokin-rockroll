// Dựng MV thật bằng ffmpeg từ clip + nhạc tự tạo (testsrc + tiếng click 120 BPM).
import { spawnSync } from "node:child_process";
import { cpSync, createReadStream, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MVResult } from "@/lib/types";

const tmp = mkdtempSync(path.join(tmpdir(), "mvps-render-"));
for (const f of readdirSync("data").filter((f) => f.endsWith(".json"))) cpSync(path.join("data", f), path.join(tmp, f));
const settingsFile = path.join(tmp, "settings.json");
writeFileSync(settingsFile, JSON.stringify({ ...JSON.parse(readFileSync(settingsFile, "utf8")), engine: "demo" }));
process.env.MV_DATA_DIR = tmp;

const src = path.join(tmp, "src-media");
let ff: typeof import("@/lib/ffmpeg");
let media: typeof import("@/lib/media");
let render: typeof import("@/lib/render");
let store: typeof import("@/lib/store");
let mv: MVResult;
let bin: string;

const stream = (file: string) => Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>;

function make(args: string[], out: string) {
  const res = spawnSync(bin, ["-hide_banner", "-loglevel", "error", "-y", ...args, out]);
  if (res.status !== 0) throw new Error(res.stderr.toString());
  return out;
}

async function waitJob(id: string, ms = 120000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const j = render.getJob(id);
    if (j && j.status !== "running") return j;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Hết thời gian chờ dựng video");
}

beforeAll(async () => {
  ff = await import("@/lib/ffmpeg");
  media = await import("@/lib/media");
  render = await import("@/lib/render");
  store = await import("@/lib/store");
  const gen = await import("@/lib/generate");
  const info = ff.findFfmpeg();
  expect(info.ok).toBe(true);
  bin = info.path!;
  mv = await gen.generateMV({ id: "r1", world_location: "Hollywood Boulevard Summer 1954", theme_code: "T01", outline: "Gặp nhau giữa phố đông" });
  rmSync(src, { recursive: true, force: true });
  spawnSync("mkdir", ["-p", src]);
}, 60000);

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("ghép video với nhạc", () => {
  it("tải nhạc: đo thời lượng, nhận nhịp 120 BPM, vẽ dạng sóng", async () => {
    const song = make(["-f", "lavfi", "-i", "aevalsrc=0.8*sin(2*PI*900*t)*exp(-40*mod(t+0.3\\,0.5))*gte(t\\,0.2):s=44100:d=16", "-c:a", "libmp3lame", "-q:a", "4"], path.join(src, "bài hát.mp3"));
    const p = await media.addAudio(mv.id, "bài hát.mp3", stream(song));
    expect(p.audio!.duration).toBeGreaterThan(15.9);
    expect(p.audio!.duration).toBeLessThan(16.2);
    expect(Math.abs(p.audio!.bpm! - 120)).toBeLessThan(1);
    expect(Math.abs(p.audio!.beat_offset - 0.2)).toBeLessThan(0.04);
    expect(existsSync(media.mediaPath(mv.id, p.audio!.waveform!))).toBe(true);
  }, 60000);

  it("tải clip: kiểm tra file, thay clip cũ, đổi chỗ", async () => {
    const hues = [0, 60, 120, 180, 240, 300];
    for (const [i, h] of hues.entries()) {
      const clip = make(["-f", "lavfi", "-i", `testsrc2=size=640x360:rate=24:duration=${i === 0 ? 2 : 5}`, "-vf", `hue=h=${h}`, "-c:v", "libx264", "-preset", "ultrafast"], path.join(src, `shot-${i + 1}.mp4`));
      await media.addClip(mv.id, mv.shots[i].shot_no, `shot-${i + 1}.mp4`, stream(clip));
    }
    // Clip dọc 9:16 cho cảnh 7
    const vertical = make(["-f", "lavfi", "-i", "testsrc=size=360x640:rate=30:duration=4", "-c:v", "libx264", "-preset", "ultrafast"], path.join(src, "doc.mp4"));
    let p = await media.addClip(mv.id, mv.shots[6].shot_no, "doc.mp4", stream(vertical));
    expect(Object.keys(p.clips)).toHaveLength(7);
    expect(p.clips[String(mv.shots[6].shot_no)]).toMatchObject({ width: 360, height: 640 });

    // File không phải video → báo lỗi, không lưu
    writeFileSync(path.join(src, "fake.mp4"), "không phải video");
    await expect(media.addClip(mv.id, mv.shots[7].shot_no, "fake.mp4", stream(path.join(src, "fake.mp4")))).rejects.toThrow(/không đọc được|không có hình/i);
    await expect(media.addClip(mv.id, mv.shots[7].shot_no, "a.txt", stream(path.join(src, "fake.mp4")))).rejects.toThrow(/đuôi/);

    const before = p.clips[String(mv.shots[0].shot_no)].file;
    p = await media.swapClips(mv.id, mv.shots[0].shot_no, mv.shots[8].shot_no);
    expect(p.clips[String(mv.shots[8].shot_no)].file).toBe(before);
    expect(p.clips[String(mv.shots[0].shot_no)]).toBeUndefined();
    p = await media.swapClips(mv.id, mv.shots[0].shot_no, mv.shots[8].shot_no);
    expect(p.clips[String(mv.shots[0].shot_no)].file).toBe(before);
    const files = readdirSync(media.mediaDir(mv.id)).filter((f) => f.startsWith("shot-"));
    expect(files).toHaveLength(7);
  }, 60000);

  it("dựng ra MP4: đúng thời lượng bài hát, đủ khung hình, có tiếng", async () => {
    await media.setOptions(mv.id, { ...(await media.loadProject(mv.id)).options, size: "720p", flipRepeats: true, fit: "fit" });
    const job = await render.startRender(mv.id);
    expect(job.status).toBe("running");
    await expect(render.startRender(mv.id)).rejects.toThrow(/đang được dựng/);
    const done = await waitJob(mv.id);
    expect(done.error).toBeUndefined();
    expect(done.status).toBe("done");
    const out = media.mediaPath(mv.id, done.output!.file);
    const info = await ff.probe(out);
    expect(Math.abs(info.duration - 16)).toBeLessThan(0.15);
    expect(info.video).toMatchObject({ width: 1280, height: 720 });
    expect(info.audio).toBe(true);
    const count = spawnSync(bin, ["-hide_banner", "-i", out, "-map", "0:v", "-f", "null", "-"]).stderr.toString();
    const frames = Number([...count.matchAll(/frame=\s*(\d+)/g)].at(-1)?.[1]);
    const p = await media.loadProject(mv.id);
    expect(frames).toBe(Math.round(p.audio!.duration * 24));
    expect(p.renders[0].file).toBe(done.output!.file);
    expect(readdirSync(media.mediaDir(mv.id)).some((f) => f.startsWith("tmp-"))).toBe(false);
  }, 180000);

  it("huỷ giữa chừng, xoá MV thì xoá luôn media", async () => {
    await render.startRender(mv.id);
    const j = render.cancelRender(mv.id)!;
    expect(j.status).toBe("cancelled");
    await new Promise((r) => setTimeout(r, 1500));
    expect(readdirSync(media.mediaDir(mv.id)).some((f) => f.startsWith("tmp-"))).toBe(false);
    await store.deleteMV(mv.id);
    expect(existsSync(media.mediaDir(mv.id))).toBe(false);
  }, 60000);
});
