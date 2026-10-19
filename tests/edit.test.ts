// Ghép video với nhạc: nhận nhịp, gán clip theo tên file, lập kế hoạch cắt cảnh.
import { describe, expect, it } from "vitest";
import { detectBeats } from "@/lib/beats";
import { assignClipFiles, shotNumberFromName } from "@/lib/clipNames";
import { DEFAULT_EDIT_OPTIONS, autoSectionStarts, buildEdit, sectionType, type EditInput } from "@/lib/edit";
import { parseProbe } from "@/lib/ffmpeg";
import { buildStructure } from "@/lib/structure";
import type { EditOptions } from "@/lib/types";

/** Tiếng trống giả: phách mạnh ở mỗi phách, hi-hat nhẹ giữa các phách, thêm nhiễu nền. */
function clickTrack(bpm: number, offset: number, seconds: number, sr = 11025): Float32Array {
  const out = new Float32Array(Math.round(seconds * sr));
  let seed = 7;
  const noise = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32) * 2 - 1;
  for (let i = 0; i < out.length; i++) out[i] = 0.02 * noise();
  const beat = 60 / bpm;
  const hit = (t: number, amp: number) => {
    const start = Math.round(t * sr);
    for (let j = 0; j < 0.05 * sr && start + j < out.length; j++) out[start + j] += amp * Math.exp(-j / (0.008 * sr)) * noise();
  };
  for (let t = offset; t < seconds; t += beat) {
    hit(t, 0.9);
    hit(t + beat / 2, 0.25);
  }
  return out;
}

describe("detectBeats", () => {
  it.each([
    [120, 0.25],
    [96, 0.4],
    [138, 0.1],
  ])("nhận ra %d BPM, phách đầu ở %ds", (bpm, offset) => {
    const info = detectBeats(clickTrack(bpm, offset, 40), 11025)!;
    expect(info).not.toBeNull();
    expect(Math.abs(info.bpm - bpm)).toBeLessThan(0.6);
    expect(Math.abs(info.offset - offset)).toBeLessThan(0.03);
    expect(info.confidence).toBeGreaterThan(0.3);
  });

  it("BPM nhập tay: chỉ tìm vị trí phách", () => {
    const info = detectBeats(clickTrack(128, 0.3, 30), 11025, 128)!;
    expect(info.bpm).toBe(128);
    expect(Math.abs(info.offset - 0.3)).toBeLessThan(0.03);
  });

  it("im lặng / quá ngắn → null", () => {
    expect(detectBeats(new Float32Array(11025 * 10), 11025)).toBeNull();
    expect(detectBeats(clickTrack(120, 0, 2), 11025)).toBeNull();
  });
});

describe("gán clip theo tên file", () => {
  const shots = Array.from({ length: 18 }, (_, i) => i + 1);
  it("đọc số cảnh trong tên", () => {
    expect(shotNumberFromName("shot-03.mp4", shots)).toBe(3);
    expect(shotNumberFromName("Cảnh 12 - final.mov", shots)).toBe(12);
    expect(shotNumberFromName("canh_7.mp4", shots)).toBe(7);
    expect(shotNumberFromName("05.mp4", shots)).toBe(5);
    expect(shotNumberFromName("MV1 #9.webm", shots)).toBe(9);
    expect(shotNumberFromName("veo3_clip_14.mp4", shots)).toBe(14);
    expect(shotNumberFromName("veo3_20261019_153012.mp4", shots)).toBeNull();
    expect(shotNumberFromName("shot-40.mp4", shots)).toBeNull();
  });

  it("file có số vào đúng cảnh, file không số lấp các cảnh trống theo tên", () => {
    const names = ["veo_b.mp4", "shot-02.mp4", "veo_a.mp4", "shot-02 (copy).mp4"];
    // cảnh 1 đã có clip
    expect(assignClipFiles(names, [1, 2, 3, 4, 5], [1])).toEqual([5, 2, 4, 3]);
    // Nhiều clip hơn số cảnh: clip thừa thành clip thêm (#3, #4…).
    expect(assignClipFiles(["a.mp4", "b.mp4", "c.mp4", "d.mp4"], [1, 2], [])).toEqual([1, 2, 3, 4]);
    expect(assignClipFiles(["x.mp4"], [1, 2], [1, 2, 7])).toEqual([8]);
  });
});

describe("parseProbe", () => {
  it("đọc thời lượng, khung hình, bỏ qua ảnh bìa", () => {
    const clip = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'a.mp4':\n  Duration: 00:00:08.04, start: 0.000000, bitrate: 2000 kb/s\n  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 1280x720 [SAR 1:1 DAR 16:9], 1996 kb/s, 24 fps, 24 tbr, 12288 tbn (default)\n  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 128 kb/s (default)`;
    expect(parseProbe(clip)).toEqual({ duration: 8.04, video: { width: 1280, height: 720, fps: 24, codec: "h264", matrix: "bt709" }, audio: true, audioCodec: "aac", channels: 2 });
    const sd = clip.replace("yuv420p(progressive)", "yuv420p(tv, smpte170m, progressive)").replace("stereo", "mono");
    expect(parseProbe(sd)).toMatchObject({ video: { matrix: "bt601" }, channels: 1 });
    const song = `Input #0, mp3, from 's.mp3':\n  Duration: 00:03:05.50, start: 0.025057, bitrate: 320 kb/s\n  Stream #0:0: Audio: mp3, 44100 Hz, stereo, fltp, 320 kb/s\n  Stream #0:1: Video: mjpeg (Baseline), yuvj420p(pc), 600x600 [SAR 1:1 DAR 1:1], 90k tbr, 90k tbn (attached pic)`;
    expect(parseProbe(song)).toEqual({ duration: 185.5, video: null, audio: true, audioCodec: "mp3", channels: 2 });
  });
});

function makeInput(over: Partial<Omit<EditInput, "options">> & { options?: Partial<EditOptions> } = {}): EditInput {
  const plan = buildStructure({ durationSec: 180, clipLen: 8, tempo: "mid", maxShots: 18, minShots: 15 });
  const clips: Record<string, { duration: number }> = {};
  for (const s of plan.shots) clips[String(s.shot_no)] = { duration: 8 };
  const { options, ...rest } = over;
  return {
    sections: plan.sections,
    planDuration: plan.duration_sec,
    tempo: plan.tempo,
    shots: plan.shots.map((s) => ({ shot_no: s.shot_no, section: s.section })),
    clips,
    audioDuration: 187.3,
    beat: null,
    ...rest,
    options: { ...DEFAULT_EDIT_OPTIONS, mode: "beat", ...options },
  };
}

function expectContiguous(plan: ReturnType<typeof buildEdit>) {
  let f = 0;
  for (const s of plan.segments) {
    expect(s.start_frame).toBe(f);
    expect(s.frames).toBeGreaterThan(0);
    f += s.frames;
  }
  expect(f).toBe(plan.total_frames);
}

describe("buildEdit", () => {
  it("phủ kín bài hát, khớp từng khung hình, không lặp clip liền nhau", () => {
    const input = makeInput();
    const plan = buildEdit(input);
    expect(plan.total_frames).toBe(Math.round(187.3 * 24));
    expectContiguous(plan);
    for (let i = 1; i < plan.segments.length; i++) expect(plan.segments[i].shot_no).not.toBe(plan.segments[i - 1].shot_no);
    // Mọi cảnh đều được dùng, nhiều cảnh được lặp lại.
    expect(Object.keys(plan.uses)).toHaveLength(input.shots.length);
    expect(plan.segments.length).toBeGreaterThan(input.shots.length * 2);
    // Lần đầu dùng clip bắt đầu từ giây 0; lần lặp lấy khúc khác.
    for (const s of plan.segments) {
      if (s.use === 0) expect(s.in_point).toBe(0);
      expect(s.in_point + s.duration).toBeLessThanOrEqual(8 + 1e-6);
    }
    expect(plan.segments.some((s) => s.use > 0 && s.in_point > 0)).toBe(true);
    expect(plan.warnings).toEqual([]);
  });

  it("điệp khúc cắt nhanh hơn verse; nhịp nhanh hơn thì nhiều nhát cắt hơn", () => {
    const plan = buildEdit(makeInput());
    const avg = (type: string) => {
      const segs = plan.segments.filter((s) => plan.sections[s.section_index].type === type);
      return segs.reduce((a, s) => a + s.duration, 0) / segs.length;
    };
    expect(avg("chorus")).toBeLessThan(avg("verse"));
    const fast = buildEdit(makeInput({ options: { pace: "fast" } }));
    const slow = buildEdit(makeInput({ options: { pace: "slow" } }));
    expect(fast.segments.length).toBeGreaterThan(plan.segments.length);
    expect(slow.segments.length).toBeLessThan(plan.segments.length);
  });

  it("cắt đúng phách khi biết nhịp", () => {
    const beat = { bpm: 120, offset: 0.25 };
    const plan = buildEdit(makeInput({ beat }));
    expect(plan.beat).toBe(0.5);
    // Mọi điểm cắt (trừ điểm cuối bài) nằm trên lưới phách (sai số ≤ 1 khung hình).
    for (const s of plan.segments.slice(1)) {
      const off = (s.start - beat.offset) / 0.5;
      expect(Math.abs(off - Math.round(off)) * 0.5).toBeLessThanOrEqual(1 / 24 + 1e-6);
    }
    const starts = autoSectionStarts({ ...makeInput({ beat }) });
    for (const t of starts.slice(1)) expect(((t - 0.25) / 2) % 1).toBeCloseTo(0, 5);
  });

  it("đoạn thiếu clip mượn cảnh cùng loại; clip ngắn được nối thêm clip khác", () => {
    const input = makeInput();
    const chorus1 = input.shots.filter((s) => s.section === "Chorus 1").map((s) => s.shot_no);
    for (const n of chorus1) delete input.clips[String(n)];
    input.clips[String(input.shots[0].shot_no)] = { duration: 1.5 };
    const plan = buildEdit(input);
    expectContiguous(plan);
    const ci = plan.sections.findIndex((s) => s.name === "Chorus 1");
    const used = new Set(plan.segments.filter((s) => s.section_index === ci).map((s) => s.shot_no));
    const otherChorus = input.shots.filter((s) => ["chorus", "final"].includes(sectionType(s.section)) && s.section !== "Chorus 1").map((s) => s.shot_no);
    expect([...used].every((n) => otherChorus.includes(n))).toBe(true);
    for (const s of plan.segments) expect(s.duration).toBeLessThanOrEqual(input.clips[String(s.shot_no)].duration + 1 / 24 + 1e-6);
    expect(plan.warnings.join(" ")).toMatch(/chưa có clip/);
  });

  it("mốc đoạn nhập tay, xáo thứ tự bằng seed, lật khi lặp", () => {
    const base = makeInput();
    const starts = autoSectionStarts(base).map((t, i) => (i === 3 ? t + 6 : t));
    const plan = buildEdit({ ...base, options: { ...base.options, sectionStarts: starts, seed: 42, flipRepeats: true } });
    expectContiguous(plan);
    expect(plan.sections[3].start).toBeCloseTo(starts[3], 5);
    expect(plan.segments.some((s) => s.flip)).toBe(true);
    expect(plan.segments.filter((s) => s.use === 0).every((s) => !s.flip)).toBe(true);
    const order = (p: ReturnType<typeof buildEdit>) => p.segments.map((s) => s.shot_no).join(",");
    expect(order(plan)).not.toBe(order(buildEdit({ ...base, options: { ...base.options, sectionStarts: starts, seed: 0 } })));
  });

  it("bài ngắn: cảnh nào có clip cũng được dùng ít nhất một lần", () => {
    for (const beat of [null, { bpm: 128, offset: 0.16 }]) {
      const plan = buildEdit(makeInput({ audioDuration: 45, beat }));
      expectContiguous(plan);
      expect(Object.keys(plan.uses)).toHaveLength(18);
      expect(plan.warnings).toEqual([]);
    }
  });

  it("chưa có clip → không có đoạn cắt, có cảnh báo", () => {
    const plan = buildEdit(makeInput({ clips: {} }));
    expect(plan.segments).toEqual([]);
    expect(plan.warnings[0]).toMatch(/Chưa có clip/);
  });
});

describe("buildEdit — ghép nguyên clip, lặp tới hết bài (mặc định)", () => {
  const fullInput = (clipSeconds: (n: number) => number, audio = 187.3, options: Partial<EditOptions> = {}) => {
    const input = makeInput({ audioDuration: audio, options: { mode: "full", ...options } });
    for (const s of input.shots) input.clips[String(s.shot_no)] = { duration: clipSeconds(s.shot_no) };
    return input;
  };

  it("mặc định là ghép nguyên clip", () => {
    expect(DEFAULT_EDIT_OPTIONS.mode).toBe("full");
  });

  it("mỗi clip phát trọn vẹn từ giây 0, theo thứ tự 1 → N, rồi lặp lại", () => {
    const input = fullInput(() => 8);
    const plan = buildEdit(input);
    expectContiguous(plan);
    const order = plan.segments.map((s) => s.shot_no);
    const n = input.shots.length;
    const shots = input.shots.map((s) => s.shot_no);
    expect(order.slice(0, n)).toEqual(shots);
    expect(order.slice(n, 2 * n)).toEqual(shots.slice(0, order.length - n));
    // Không cắt nhỏ: mọi đoạn trừ đoạn cuối dài đúng 8 giây và bắt đầu từ đầu clip.
    for (const s of plan.segments.slice(0, -1)) {
      expect(s.frames).toBe(8 * 24);
      expect(s.in_point).toBe(0);
    }
    expect(plan.round_seconds).toBe(n * 8);
    expect(plan.rounds).toBeCloseTo(187.3 / (n * 8), 2);
    expect(plan.warnings).toEqual([]);
  });

  it("clip dài ngắn khác nhau (5 s, 10 s…) vẫn phát nguyên; cuối bài còn chưa tới 1 s thì giữ khung cuối", () => {
    const input = fullInput((n) => (n % 2 ? 10 : 5.04), 7.5 * 18 + 10.5);
    const plan = buildEdit(input);
    expectContiguous(plan);
    for (const s of plan.segments.slice(0, -1)) expect(s.frames).toBe(Math.floor(input.clips[String(s.shot_no)].duration * 24 + 1e-6));
    const last = plan.segments.at(-1)!;
    expect(last.duration).toBeGreaterThanOrEqual(1);
  });

  it("thiếu clip thì lặp các clip đã có; xáo các vòng sau không mở vòng bằng clip vừa hết", () => {
    const input = fullInput(() => 8, 400, { seed: 7 });
    const shots = input.shots.map((s) => s.shot_no);
    delete input.clips[String(shots[2])];
    const plan = buildEdit(input);
    expectContiguous(plan);
    const order = plan.segments.map((s) => s.shot_no);
    expect(order).not.toContain(shots[2]);
    const m = shots.length - 1;
    expect(order.slice(0, m)).toEqual(shots.filter((x) => x !== shots[2]));
    expect(order.slice(m, 2 * m)).not.toEqual(order.slice(0, m));
    expect(new Set(order.slice(m, 2 * m)).size).toBe(m);
    for (let i = 1; i < order.length; i++) expect(order[i]).not.toBe(order[i - 1]);
    expect(plan.warnings.join(" ")).toMatch(/lặp các clip đã có/);
  });

  it("lật ngang ở các lần lặp lẻ khi bật tuỳ chọn", () => {
    const plan = buildEdit(fullInput(() => 8, 400, { flipRepeats: true }));
    expect(plan.segments.filter((s) => s.use === 0).every((s) => !s.flip)).toBe(true);
    expect(plan.segments.filter((s) => s.use === 1).every((s) => s.flip)).toBe(true);
  });
});

describe("clip thêm (nhiều clip hơn số cảnh)", () => {
  it("ghép nguyên clip: clip thêm phát nối tiếp sau cảnh cuối; cắt theo nhịp thì không dùng", () => {
    const input = makeInput({ audioDuration: 400, options: { mode: "full" } });
    const shots = input.shots.map((s) => s.shot_no);
    const last = Math.max(...shots);
    input.clips[String(last + 1)] = { duration: 8 };
    input.clips[String(last + 2)] = { duration: 8 };
    const plan = buildEdit(input);
    const order = plan.segments.map((s) => s.shot_no);
    expect(order.slice(0, shots.length + 2)).toEqual([...shots, last + 1, last + 2]);
    expect(plan.round_seconds).toBe((shots.length + 2) * 8);
    const beat = buildEdit({ ...input, options: { ...input.options, mode: "beat" } });
    expect(beat.segments.some((s) => s.shot_no > last)).toBe(false);
    expect(beat.warnings.join(" ")).toMatch(/2 clip thêm/);
  });
});
