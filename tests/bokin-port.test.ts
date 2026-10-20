// Các phần chuyển từ Bokin Studio Music: cân bằng âm lượng, preset YouTube, logo / intro, font.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_INTRO, DEFAULT_LOGO_LAYOUT, downloadName, focusPull, fontSize, introAss, introSpan, logoFilters, metadataArgs, mvTags } from "@/lib/branding";
import { DEFAULT_EDIT_OPTIONS, mergeEditOptions } from "@/lib/edit";
import { readFontInfo } from "@/lib/fonts";
import { gainDecision, parseEbur128, retryGain, volumeFilter } from "@/lib/loudness";
import { videoEncoderArgs, youtubeMaxrate } from "@/lib/quality";
import { segmentGraph, type Look } from "@/lib/render";
import type { EditSegment } from "@/lib/types";

const SUMMARY = `[Parsed_ebur128_0 @ 0x1] Summary:

  Integrated loudness:
    I:         -17.5 LUFS
    Threshold: -27.5 LUFS

  True peak:
    Peak:       -1.3 dBFS`;
const FRAMES = `frame:449  pts:1980090 pts_time:44.9
lavfi.r128.M=-17.371
lavfi.r128.I=-17.532
lavfi.r128.true_peaks_ch0=0.859
lavfi.r128.true_peak=0.859`;

describe("cân bằng âm lượng (loudness.py)", () => {
  it("đọc ebur128: I từ khung cuối, true peak tuyến tính → dBTP", () => {
    const s = parseEbur128("lavfi.r128.I=-30\n" + FRAMES, SUMMARY);
    expect(s.integrated_lufs).toBeCloseTo(-17.532, 6);
    expect(s.true_peak_dbtp).toBeCloseTo(20 * Math.log10(0.859), 6);
  });

  it("im lặng → null; thiếu số đo → lỗi", () => {
    const silent = parseEbur128("frame:1\nlavfi.r128.I=-70.0\nlavfi.r128.true_peak=0.000", "I: -70.0 LUFS\n    Peak: -inf dBFS");
    expect(silent).toEqual({ integrated_lufs: null, true_peak_dbtp: null });
    expect(() => parseEbur128("frame:1\nlavfi.r128.M=-20", SUMMARY)).toThrow(/Thiếu/);
    expect(() => parseEbur128("", "không có gì")).toThrow();
  });

  it("gain = min(mục tiêu − I, trần − TP, 12 dB)", () => {
    const cfg = { enabled: true, target_lufs: -14, true_peak_dbtp: -1.5 };
    // Bài to (-9 LUFS, đỉnh -0.2): giảm 5 dB, đạt mục tiêu.
    expect(gainDecision({ integrated_lufs: -9, true_peak_dbtp: -0.2 }, cfg)).toMatchObject({ applied_gain_db: -5, target_reached: true, peak_limited: false });
    // Bài nhỏ nhưng đỉnh cao: bị trần đỉnh chặn.
    const limited = gainDecision({ integrated_lufs: -17.53, true_peak_dbtp: -1.32 }, cfg);
    expect(limited.applied_gain_db).toBeCloseTo(-0.18, 6);
    expect(limited).toMatchObject({ peak_limited: true, target_reached: false });
    // Rất nhỏ: nâng tối đa 12 dB.
    expect(gainDecision({ integrated_lufs: -40, true_peak_dbtp: -30 }, cfg)).toMatchObject({ applied_gain_db: 12, boost_limited: true });
    // Không đo được loudness: không đổi gain.
    expect(gainDecision({ integrated_lufs: null, true_peak_dbtp: null }, cfg).applied_gain_db).toBe(0);
  });

  it("AAC vượt trần thì giảm gain, quá 3 lần thì dừng", () => {
    expect(retryGain(-1.45, -1.5, -5, 1)).toBeNull();
    expect(retryGain(-1.0, -1.5, -5, 1)).toBeCloseTo(-5.6, 6);
    expect(() => retryGain(-1.0, -1.5, -5.6, 3)).toThrow(/3 lần/);
    expect(volumeFilter(0)).toMatch(/^volume=1\.0+:precision=double:eval=once:replaygain=drop$/);
  });
});

describe("preset YouTube (quality.py)", () => {
  it("giới hạn bitrate theo bảng SDR của YouTube (×1,5 dưới 4K)", () => {
    expect(youtubeMaxrate(1080, 24)).toBe(12_000_000);
    expect(youtubeMaxrate(1080, 60)).toBe(18_000_000);
    expect(youtubeMaxrate(720, 30)).toBe(7_500_000);
    expect(youtubeMaxrate(1920, 24)).toBe(24_000_000); // Shorts dọc 1080×1920
    expect(youtubeMaxrate(2160, 24)).toBe(45_000_000);
  });
  it("High profile, keyframe mỗi nửa giây, không B-frame, gắn BT.709", () => {
    const a = videoEncoderArgs("youtube", 1080, 24).join(" ");
    expect(a).toContain("-crf 17");
    expect(a).toContain("-g 12");
    expect(a).toContain("-bf 0");
    expect(a).toContain("-profile:v high");
    expect(a).toContain("-colorspace bt709");
    expect(videoEncoderArgs("fast", 720, 30).join(" ")).toContain("-preset veryfast");
  });
});

describe("logo / intro (branding.py)", () => {
  it("logo góc: rộng size% chiều ngang, lề theo chiều cao, mặt nạ tròn, mờ dần từ giây bắt đầu", () => {
    const l = logoFilters({ ...DEFAULT_LOGO_LAYOUT, shape: "circle", opacity_percent: 80 }, 1, 1920, 1080, 24, 0, 48)!;
    expect(l.prepare).toContain("scale=230:-2");
    expect(l.prepare).toContain("geq=");
    expect(l.prepare).toContain("colorchannelmixer=aa=0.800");
    expect(l.overlay).toContain("overlay=x=W-w-32:y=32");
    const late = { ...DEFAULT_LOGO_LAYOUT, start_seconds: 10 };
    expect(logoFilters(late, 1, 1920, 1080, 24, 0, 48)).toBeNull();
    expect(logoFilters(late, 1, 1920, 1080, 24, 9, 48)!.prepare).toContain("fade=t=in:st=10.0000:d=0.6:alpha=1");
    expect(logoFilters(late, 1, 1920, 1080, 24, 20, 48)!.prepare).not.toContain("fade=");
  });

  it("nền mờ: đầy đủ trong intro, rõ dần 1,5 s sau đó, theo thời gian trên timeline", () => {
    const intro = { ...DEFAULT_INTRO, enabled: true };
    expect(introSpan(intro)).toBe(7.5);
    const during = focusPull(intro, 24, 1080, 0, 48);
    expect(during).toContain("gblur@intro=sigma=21.600");
    expect(during).not.toContain("sendcmd");
    const clearing = focusPull(intro, 24, 1080, 5, 48);
    expect(clearing).toContain("sendcmd=c='5.9990 gblur@intro sigma 21.600");
    expect(clearing).toContain("enable='lt(t,7.5000)'");
    expect(focusPull(intro, 24, 1080, 8, 48)).toBe("");
  });

  it("phụ đề ASS: chữ hiện từ 0,6 s, mờ vào/ra 1 s, cỡ chữ theo chiều cao", () => {
    const ass = introAss({ ...DEFAULT_INTRO, enabled: true, subtitle: "Bokin Rock & Roll {kênh}" }, "Ferris Wheel Heart", 1920, 1080, { name: "Segoe UI Bold", bold: true });
    expect(ass).toContain("PlayResY: 1080");
    expect(ass).toContain("Style: Title,Segoe UI Bold,81,");
    expect(ass).toContain("Dialogue: 0,0:00:00.60,0:00:06.00,Title,,0,0,0,,{\\an5\\pos(960,475)\\fad(1000,1000)}Ferris Wheel Heart");
    expect(ass).toContain("Bokin Rock & Roll (kênh)");
    expect(fontSize("A".repeat(60), 81, 1920)).toBe(52);
  });

  it("thông tin MP4 tự lấy từ gợi ý YouTube lúc dựng kịch bản", () => {
    const mv = {
      youtube_titles: ["Ferris Wheel Heart | 1950s Rock & Roll Love Story", "B", "C"],
      youtube_description: "Imagine turning the dial…\r\nA summer night on the pier.\n\n#rockandroll #1950s #doowop #rockandroll",
      idea: { id: "9", world_location: "Santa Monica Pier 1955", theme_code: "T01", outline: "", song_title: "Ferris Wheel Heart" },
    };
    const tags = mvTags(mv, { artist: "Bokin Rock & Roll", genre: "Rock & Roll" }, new Date("2026-10-19"));
    expect(tags).toEqual({
      title: "Ferris Wheel Heart | 1950s Rock & Roll Love Story",
      description: "Imagine turning the dial…\nA summer night on the pier.\n\n#rockandroll #1950s #doowop #rockandroll",
      keywords: ["rockandroll", "1950s", "doowop"],
      artist: "Bokin Rock & Roll",
      genre: "Rock & Roll",
      year: "2026",
    });
    expect(metadataArgs(tags)).toEqual([
      "-metadata", "title=Ferris Wheel Heart | 1950s Rock & Roll Love Story",
      "-metadata", "artist=Bokin Rock & Roll",
      "-metadata", "genre=Rock & Roll",
      "-metadata", "date=2026",
      "-metadata", `comment=${tags.description}`,
      "-metadata", `description=${tags.description}`,
      "-metadata", "keywords=rockandroll, 1950s, doowop",
    ]);
    // Chưa có gợi ý tiêu đề → tên bài; tên file tải về bỏ ký tự Windows không cho phép.
    const bare = mvTags({ ...mv, youtube_titles: ["", " "], youtube_description: "Old description." }, { artist: "", genre: "Rock & Roll" });
    expect(bare.title).toBe("Ferris Wheel Heart");
    expect(bare.keywords).toEqual(["Rock & Roll", "Santa Monica Pier 1955"]);
    expect(downloadName(tags.title)).toBe("Ferris Wheel Heart 1950s Rock & Roll Love Story.mp4");
    expect(downloadName('Tình yêu: "Đu quay"?')).toBe("Tình yêu Đu quay.mp4");
  });

  it("gộp tuỳ chọn cũ", () => {
    const old = mergeEditOptions({ pace: "fast", loudness: { enabled: false } } as never);
    expect(old.pace).toBe("fast");
    expect(old.loudness).toEqual({ ...DEFAULT_EDIT_OPTIONS.loudness, enabled: false });
    expect(old.intro).toEqual(DEFAULT_EDIT_OPTIONS.intro);
  });

  // Font đậm có sẵn trên máy (Linux / Windows / macOS) → tên họ font, tên đầy đủ.
  const BOLD_FONT = (
    [
      ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "DejaVu Sans", "DejaVu Sans Bold"],
      ["C:\\Windows\\Fonts\\arialbd.ttf", "Arial", "Arial Bold"],
      ["/System/Library/Fonts/Supplemental/Arial Bold.ttf", "Arial", "Arial Bold"],
      ["/Library/Fonts/Arial Bold.ttf", "Arial", "Arial Bold"],
    ] as const
  ).find(([p]) => existsSync(p));

  it.skipIf(!BOLD_FONT)("đọc tên font TrueType", () => {
    const [file, family, fullName] = BOLD_FONT!;
    expect(readFontInfo(readFileSync(file))).toEqual({ family, fullName, bold: true });
    expect(readFontInfo(Buffer.from("không phải font"))).toBeNull();
  });
});

describe("bộ lọc một đoạn", () => {
  const look = (over: Partial<Look["opts"]> = {}, logo: string | null = null): Look => ({
    w: 1920,
    h: 1080,
    fps: 24,
    opts: { ...DEFAULT_EDIT_OPTIONS, ...over },
    total: 180,
    logo,
    title: "Ferris",
    textMode: "ass",
    fontFile: "intro_font.ttf",
    fadeIn: 1.5,
  });
  const seg = (start_frame: number, frames = 48): EditSegment => ({ start_frame, frames, start: start_frame / 24, duration: frames / 24, shot_no: 3, in_point: 0, flip: false, use: 0, section_index: 0 });

  it("đoạn giữa bài: chỉ chuẩn hoá hình + màu BT.709, đẩy mốc thời gian về timeline", () => {
    const { graph, usesLogo } = segmentGraph(seg(24 * 60), "bt601", look());
    expect(usesLogo).toBe(false);
    expect(graph).toContain("flags=lanczos:in_color_matrix=bt601:out_color_matrix=bt709");
    expect(graph).toContain("setpts=PTS+60.000000/TB");
    expect(graph).toContain("setparams=color_primaries=bt709");
    expect(graph).not.toMatch(/fade=|subtitles|gblur/);
  });

  it("đoạn đầu có intro + logo: mờ nền, logo, mờ từ đen, chữ; đoạn cuối mờ dần ra", () => {
    const intro = { ...DEFAULT_INTRO, enabled: true };
    const { graph, usesLogo } = segmentGraph(seg(24), "bt709", look({ intro }, "/tmp/logo.png"));
    expect(usesLogo).toBe(true);
    expect(graph.indexOf("gblur@intro")).toBeLessThan(graph.indexOf("overlay="));
    expect(graph.indexOf("overlay=")).toBeLessThan(graph.indexOf("fade=t=in"));
    expect(graph.indexOf("fade=t=in")).toBeLessThan(graph.indexOf("subtitles=intro.ass"));
    expect(segmentGraph(seg(24 * 179), "bt709", look()).graph).toContain("fade=t=out:st=178.000:d=2.000");
    expect(segmentGraph(seg(24 * 60), "bt709", look({ quality: "fast" })).graph).not.toContain("lanczos");
  });
});
