// Dây chuyền tự động (ý tưởng → kịch bản → bài hát → clip Muse → MP4) với chế độ Demo + "Muse giả" + thư mục nhạc tạm:
// chạy thật từ đầu tới cuối (dựng MP4 bằng ffmpeg), không tốn lượt Muse, không gọi Claude.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FAST, FakeMuse, waitFor } from "./fakeMuse";

const tmp = mkdtempSync(path.join(tmpdir(), "mvps-auto-"));
for (const f of readdirSync("data").filter((f) => f.endsWith(".json"))) cpSync(path.join("data", f), path.join(tmp, f));
const songs = path.join(tmp, "nhac");
const settingsFile = path.join(tmp, "settings.json");
const base = { ...JSON.parse(readFileSync(settingsFile, "utf8")), engine: "demo", museMode: "gateway", songDir: songs, museAutoRender: false, museAvoid: true };
const setSettings = (patch: Record<string, unknown> = {}) => writeFileSync(settingsFile, JSON.stringify({ ...base, ...patch }));
setSettings();
process.env.MV_DATA_DIR = tmp;
process.env.MUSE_NO_WATCH = "1";
process.env.PIPELINE_NO_WATCH = "1";

let bin: string;
const make = (args: string[], out: string) => {
  const r = spawnSync(bin, ["-hide_banner", "-loglevel", "error", "-y", ...args, out]);
  if (r.status !== 0) throw new Error(r.stderr.toString());
  return out;
};

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("tự ghép bài hát (so tên bài với tên file)", () => {
  // Tên file thật trong thư mục nhạc của kênh.
  const files = [
    "Anh Còn Nợ Em - Nam Metal Rock.WAV",
    "Chuyến xe lam chiều rock.WAV",
    "Dấu Tình Sầu - Rock Version.wav",
    "Sương Lạnh Chiều Đông1 - nam metal rock.wav",
    "Đèn Khuya - Nam Rock.wav",
    "Đèn Khuya - Rock Version.wav",
    "Đêm lang thang - Rock Version.wav",
  ];

  it("bỏ dấu, bỏ phần phiên bản / chữ rock / số dính ở cuối", async () => {
    const { normSong, songBase } = await import("@/lib/songs");
    expect(normSong("Đèn Khuya")).toBe("den khuya");
    expect(songBase("Đèn Khuya - Rock Version.wav")).toBe("den khuya");
    expect(songBase("Chuyến xe lam chiều rock.WAV")).toBe("chuyen xe lam chieu");
    expect(songBase("Sương Lạnh Chiều Đông1 - nam metal rock.wav")).toBe("suong lanh chieu dong");
    expect(songBase("Phương Nam.mp3")).toBe("phuong nam");
  });

  it("chọn đúng bài; ghi rõ phiên bản thì chọn đúng file; trùng tên thì báo; không thấy thì null", async () => {
    const { pickSong } = await import("@/lib/songs");
    expect(pickSong("Chuyến Xe Lam Chiều", files)?.file).toBe("Chuyến xe lam chiều rock.WAV");
    expect(pickSong("sương lạnh chiều đông", files)?.file).toBe("Sương Lạnh Chiều Đông1 - nam metal rock.wav");
    expect(pickSong("Đèn Khuya - Rock Version", files)).toMatchObject({ file: "Đèn Khuya - Rock Version.wav", score: 1 });
    expect(pickSong("Đèn Khuya", files)).toMatchObject({ score: 0.95, ties: 1 });
    expect(pickSong("Neon Heartbeat", files)).toBeNull();
    expect(pickSong("Đêm", files)).toBeNull(); // một chữ chung không đủ
  });
});

describe("dây chuyền: ý tưởng → MP4", () => {
  let fake: FakeMuse;
  let engine: Awaited<ReturnType<typeof import("@/lib/museEngine")["initMuseEngine"]>>;

  beforeAll(async () => {
    bin = (await import("@/lib/ffmpeg")).findFfmpeg().path!;
    mkdirSync(songs, { recursive: true });
    make(["-f", "lavfi", "-i", "sine=frequency=330:duration=12", "-c:a", "libmp3lame"], path.join(songs, "Đèn Khuya - Rock Version.mp3"));
    const clip = make(["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24:duration=2", "-c:v", "libx264", "-preset", "ultrafast"], path.join(tmp, "clip.mp4"));
    fake = new FakeMuse(readFileSync(clip));
    engine = (await import("@/lib/museEngine")).initMuseEngine({ dir: path.join(tmp, "muse-engine"), page: fake, worker: FAST });
    // Dựng nhanh cho test: 720p, chất lượng "Nhanh".
    const media = await import("@/lib/media");
    const shared = await media.loadProject("_shared");
    await media.setOptions("_shared", { ...shared.options, size: "720p", quality: "fast" });
  }, 120000);

  afterAll(async () => (await import("@/lib/museEngine")).closeMuseEngine());

  /** Muse giả làm xong lần lượt mọi lệnh đã nhận (cổng chạy từng lệnh một). */
  async function museFinishAll() {
    for (let k = 1; k <= engine.store.list().length; k++) {
      await waitFor(() => fake.sent.length >= k, 5000, `Muse nhận lệnh ${k}`);
      fake.finish(k);
    }
    await waitFor(() => engine.store.list().every((t) => t.status === "succeeded"), 5000, "Muse làm xong");
  }

  it("chế độ claude.ai (chưa có API key) → không nhận ý tưởng", async () => {
    const pl = await import("@/lib/pipeline");
    setSettings({ engine: "manual" });
    await expect(pl.addToPipeline({ ideas: [{ id: "x", world_location: "Las Vegas 1956", theme_code: "T01", outline: "o" }] })).rejects.toThrow(/API key/);
    setSettings();
  });

  it("viết kịch bản (Demo) → tự ghép bài trùng tên → gửi Muse → nhận clip → dựng MP4", async () => {
    const pl = await import("@/lib/pipeline");
    const jobs = await import("@/lib/museJobs");
    const queue = await import("@/lib/queue");
    const media = await import("@/lib/media");
    const added = await pl.addToPipeline({
      ideas: [
        { id: "1", world_location: "Santa Monica Pier Summer 1955", theme_code: "T01", outline: "Gặp nhau bên vòng đu quay", song_title: "Đèn Khuya" },
        { id: "2", world_location: "Times Square Winter 1956", theme_code: "T01", outline: "Hẹn hò mùa đông", song_title: "Bài Chưa Có" },
      ],
    });
    expect(added).toBe(2);
    const item = async (n: number) => (await pl.readPipeline()).items.find((i) => i.idea?.id === String(n))!;

    // 1. Kịch bản: từng MV một; bài có trong thư mục nhạc → MV dài đúng bằng bài (12 giây).
    await pl.pipelineTick();
    await pl.pipelineIdle();
    await pl.pipelineTick();
    await pl.pipelineIdle();
    const a = await item(1);
    expect(a.steps.script).toMatchObject({ status: "done" });
    const store = await import("@/lib/store");
    const mv = (await store.loadMV(a.mv_id!))!;
    expect(mv.idea.duration_sec).toBe(12);

    // 2–3. Bài hát tự ghép, các cảnh được gửi sang Muse.
    await pl.pipelineTick();
    const a2 = await item(1);
    expect(a2.steps.song).toMatchObject({ status: "done", message: expect.stringMatching(/Đèn Khuya - Rock Version\.mp3/) });
    expect(a2.clips_sent).toBe(true);
    expect((await media.loadProject(mv.id)).audio?.name).toBe("Đèn Khuya - Rock Version.mp3");
    const b = await item(2);
    expect(b.steps.song).toMatchObject({ status: "waiting", message: expect.stringMatching(/Chưa thấy bài “Bài Chưa Có”/) });

    // Muse giả làm xong → clip vào MV.
    await museFinishAll();
    await jobs.museTick();
    expect(Object.keys((await media.loadProject(mv.id)).clips)).toHaveLength(mv.shots.length);

    // 4. Đủ clip + có bài → dựng MP4.
    await pl.pipelineTick();
    expect((await item(1)).steps.render.status).toBe("running");
    await queue.idle();
    await pl.pipelineTick();
    const done = await item(1);
    expect(done.steps.render.status).toBe("done");
    expect(done.done_at).toBeTruthy();
    expect(existsSync(media.mediaPath(mv.id, done.output!))).toBe(true);
    expect((await media.loadProject(mv.id)).renders[0]).toMatchObject({ file: done.output, verification: { passed: true } });

    // Việc 2 vẫn chờ bài hát; bỏ khỏi dây chuyền.
    expect((await item(2)).done_at).toBeUndefined();
    await pl.removeFromPipeline((await item(2)).id);
    await pl.clearFinishedPipeline();
    expect((await pl.readPipeline()).items).toHaveLength(0);
  }, 300000);
});
