import { describe, expect, it } from "vitest";
import { apportion, buildStructure, formatTime, parseLyrics, resolveTempo, tempoFromBpm } from "@/lib/structure";

const SIGS = ["eye-contact slow motion", "crowd blurs around the couple", "freeze-frame glance"];

function checkTimeline(plan: ReturnType<typeof buildStructure>) {
  let t = 0;
  for (const s of plan.shots) {
    expect(s.start_sec).toBe(t);
    expect(s.duration_sec).toBeGreaterThan(0);
    t += s.duration_sec;
  }
  expect(t).toBe(plan.duration_sec);
  plan.shots.forEach((s, i) => expect(s.shot_no).toBe(i + 1));
}

describe("apportion", () => {
  it("chia đúng tổng và giữ tối thiểu", () => {
    const r = apportion([1.4, 2.6, 0.5, 5.5], 10, 1);
    expect(r.reduce((a, b) => a + b, 0)).toBe(10);
    expect(Math.min(...r)).toBeGreaterThanOrEqual(1);
  });
  it("trọng số 0 nhận 0", () => {
    expect(apportion([0, 3, 3], 4, 1)).toEqual([0, 2, 2]);
  });
});

describe("buildStructure", () => {
  it("bài 3 phút, clip 8s → 23 cảnh, phủ kín timeline", () => {
    const plan = buildStructure({ durationSec: 180, clipLen: 8, tempo: "mid", signatureShots: SIGS });
    expect(plan.total_shots).toBe(23);
    expect(plan.shots).toHaveLength(23);
    checkTimeline(plan);
    expect(plan.sections.map((s) => s.name)).toEqual([
      "Intro", "Verse 1", "Pre-chorus", "Chorus 1", "Verse 2", "Chorus 2", "Bridge", "Final chorus", "Outro",
    ]);
  });

  it("tỉ lệ thời lượng các đoạn gần với cấu trúc mặc định", () => {
    const plan = buildStructure({ durationSec: 200, clipLen: 8, tempo: "mid" });
    const verse1 = plan.sections.find((s) => s.name === "Verse 1")!;
    expect(verse1.duration_sec).toBe(34); // 17% của 200
    const outro = plan.sections.find((s) => s.name === "Outro")!;
    expect(outro.duration_sec).toBe(10); // 5%
    checkTimeline(plan);
  });

  it("nhịp fast → chorus dùng clip ngắn hơn và nhiều cảnh hơn", () => {
    const mid = buildStructure({ durationSec: 180, clipLen: 8, tempo: "mid" });
    const fast = buildStructure({ durationSec: 180, clipLen: 8, tempo: "fast" });
    const chorusCount = (p: typeof mid) => p.shots.filter((s) => /chorus/i.test(s.section) && !/pre/i.test(s.section)).length;
    expect(fast.total_shots).toBeGreaterThan(mid.total_shots);
    expect(chorusCount(fast)).toBeGreaterThan(chorusCount(mid));
    expect(fast.sections.find((s) => s.name === "Chorus 1")!.clip_len).toBe(5);
    expect(fast.sections.find((s) => s.name === "Verse 1")!.clip_len).toBe(8);
    checkTimeline(fast);
  });

  it("tôn trọng số cảnh tối đa", () => {
    const plan = buildStructure({ durationSec: 240, clipLen: 6, tempo: "mid", maxShots: 20 });
    expect(plan.total_shots).toBe(20);
    checkTimeline(plan);
  });

  it("giới hạn 15–20 cảnh cho mọi độ dài bài / độ dài clip", () => {
    for (const durationSec of [90, 120, 180, 200, 240, 300]) {
      for (const clipLen of [6, 8, 10]) {
        for (const tempo of ["slow", "mid", "fast"] as const) {
          const plan = buildStructure({ durationSec, clipLen, tempo, minShots: 15, maxShots: 20 });
          expect(plan.total_shots).toBeGreaterThanOrEqual(15);
          expect(plan.total_shots).toBeLessThanOrEqual(20);
          checkTimeline(plan);
        }
      }
    }
    // bài ngắn được nâng lên tối thiểu, có ghi chú
    const short = buildStructure({ durationSec: 90, clipLen: 10, tempo: "mid", minShots: 15, maxShots: 20 });
    expect(short.total_shots).toBe(15);
    expect(short.notes.join(" ")).toMatch(/tối thiểu 15/);
    // bài dài bị giới hạn, có ghi chú lặp cảnh
    const long = buildStructure({ durationSec: 240, clipLen: 8, tempo: "mid", minShots: 15, maxShots: 20 });
    expect(long.total_shots).toBe(20);
    expect(long.notes.join(" ")).toMatch(/lặp lại/);
  });

  it("bài rất ngắn với ít cảnh vẫn phủ kín timeline", () => {
    const plan = buildStructure({ durationSec: 30, clipLen: 10, tempo: "mid" });
    expect(plan.total_shots).toBe(3);
    checkTimeline(plan);
    expect(plan.sections[0].start_sec).toBe(0);
  });

  it("mỗi chorus có ít nhất 1 cảnh chuyển động mạnh", () => {
    const plan = buildStructure({ durationSec: 180, clipLen: 8, tempo: "mid" });
    for (const sec of ["Chorus 1", "Chorus 2", "Final chorus"]) {
      expect(plan.shots.some((s) => s.section === sec && s.must_motion)).toBe(true);
    }
  });

  it("Pre-chorus không bị tính là chorus", () => {
    const plan = buildStructure({ durationSec: 180, clipLen: 8, tempo: "fast" });
    expect(plan.shots.some((s) => s.section === "Pre-chorus" && s.must_motion)).toBe(false);
    expect(plan.sections.find((s) => s.name === "Pre-chorus")!.clip_len).toBe(8);
  });

  it("signature shots được gán ít nhất 2 lần, mỗi loại ít nhất 1 lần", () => {
    const plan = buildStructure({ durationSec: 180, clipLen: 8, tempo: "mid", signatureShots: SIGS });
    const used = plan.shots.filter((s) => s.signature_shot).map((s) => s.signature_shot);
    expect(used.length).toBeGreaterThanOrEqual(2);
    for (const sig of SIGS) expect(used).toContain(sig);
    // một signature shot duy nhất vẫn dùng 2 lần
    const one = buildStructure({ durationSec: 180, clipLen: 8, tempo: "mid", signatureShots: ["slow push-in"] });
    expect(one.shots.filter((s) => s.signature_shot).length).toBe(2);
  });

  it("cỡ cảnh luân phiên, mở và kết bằng toàn cảnh", () => {
    const plan = buildStructure({ durationSec: 180, clipLen: 8, tempo: "mid" });
    expect(plan.shots[0].size_hint).toBe("wide");
    expect(plan.shots[plan.shots.length - 1].size_hint).toBe("wide");
    for (let i = 1; i < plan.shots.length; i++) {
      expect(plan.shots[i].size_hint).not.toBe(plan.shots[i - 1].size_hint);
    }
  });

  it("ghi chú BPM khi có BPM số", () => {
    const plan = buildStructure({ durationSec: 180, clipLen: 8, tempo: "fast", bpm: 160 });
    expect(plan.bpm).toBe(160);
    expect(plan.notes.join(" ")).toMatch(/BPM 160/);
  });
});

describe("lyrics", () => {
  const lyrics = `[Intro]
[Verse 1]
Walking down the boulevard
Sun is shining bright
[Chorus]
Ferris wheel heart, spinning round
[Verse 2]
Line two A
Line two B
[Chorus]
Chorus again
[Bridge]
Quiet now
[Chorus]
Last chorus line
[Outro]
Goodbye`;

  it("nhận diện nhãn đoạn", () => {
    const names = ["Intro", "Verse 1", "Pre-chorus", "Chorus 1", "Verse 2", "Chorus 2", "Bridge", "Final chorus", "Outro"];
    const { lines, hasMarkers } = parseLyrics(lyrics, names);
    expect(hasMarkers).toBe(true);
    expect(lines.find((l) => l.text === "Ferris wheel heart, spinning round")!.section).toBe("Chorus 1");
    expect(lines.find((l) => l.text === "Chorus again")!.section).toBe("Chorus 2");
    expect(lines.find((l) => l.text === "Last chorus line")!.section).toBe("Final chorus");
    expect(lines.find((l) => l.text === "Goodbye")!.section).toBe("Outro");
  });

  it("gán câu hát vào cảnh thuộc đúng đoạn", () => {
    const plan = buildStructure({ durationSec: 180, clipLen: 8, tempo: "mid", lyrics });
    const chorusShot = plan.shots.find((s) => s.lyric_line?.includes("Ferris wheel heart"))!;
    expect(chorusShot.section).toBe("Chorus 1");
    const verse = plan.shots.find((s) => s.lyric_line?.includes("Walking down"))!;
    expect(verse.section).toBe("Verse 1");
    const all = plan.shots.map((s) => s.lyric_line).filter(Boolean).join(" / ");
    for (const line of ["Sun is shining bright", "Line two B", "Quiet now", "Goodbye"]) expect(all).toContain(line);
  });

  it("lời không có nhãn được rải theo thời gian, bỏ qua Intro/Outro", () => {
    const plain = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n");
    const plan = buildStructure({ durationSec: 180, clipLen: 8, tempo: "mid", lyrics: plain });
    const withLyrics = plan.shots.filter((s) => s.lyric_line);
    expect(withLyrics.length).toBe(10);
    expect(withLyrics.every((s) => s.section !== "Intro" && s.section !== "Outro")).toBe(true);
    expect(withLyrics[0].lyric_line).toBe("line 1");
  });
});

describe("helpers", () => {
  it("tempo từ BPM và ưu tiên", () => {
    expect(tempoFromBpm(70)).toBe("slow");
    expect(tempoFromBpm(120)).toBe("mid");
    expect(tempoFromBpm(170)).toBe("fast");
    expect(resolveTempo({ bpm: 170, tempo: "slow" }, { pacing: "mid" })).toBe("fast");
    expect(resolveTempo({}, { pacing: "slow" })).toBe("slow");
    expect(resolveTempo({}, null)).toBe("mid");
  });
  it("formatTime", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(75)).toBe("1:15");
  });
});
