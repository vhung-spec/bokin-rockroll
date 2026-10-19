// Dựng MV hoàn chỉnh bằng ffmpeg. Chạy nền, có tiến độ và nút huỷ.
// Khâu cắt cảnh theo nhịp là của MV Prompt Studio (edit.ts); khâu xuất chuyển từ engine của Bokin Studio Music:
//   1. Bài hát → FLAC 48 kHz stereo 24-bit (mono được nhân đôi đúng mức).
//   2. Đo âm lượng (ebur128, true peak) → một mức gain cố định (loudness.ts).
//   3. Mỗi đoạn cắt được mã hoá với cùng một bộ tham số (SPS/PPS giống nhau, không B-frame) + logo / intro / màu BT.709.
//   4. AAC: đo lại đỉnh trên tiếng đã giải mã, vượt trần thì giảm gain và mã hoá lại (tối đa 3 lần).
//   5. Nối hình bằng stream copy + tiếng, ghi thông tin video, kiểm tra đầu ra (thời lượng ±0,1 s, đủ khung hình,
//      giải mã hết) rồi mới công bố file.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { cleanText, downloadName, focusPull, introAss, introSpan, introText, logoFilters, metadataArgs, mvTags, overlapsIntroText, LOGO_FADE_IN, FADE_FROM_BLACK, type TextMode } from "./branding";
import { RENDER_SIZES, SHARED_ID, applyShared, buildEdit, editInputFrom } from "./edit";
import { exportFileBase } from "./exporters";
import { FfmpegError, ffmpegOrThrow, findFfmpeg, hasFilter, probe, type RunOptions } from "./ffmpeg";
import { defaultFont, readFontInfo } from "./fonts";
import { EBUR128_FILTER, MAX_AAC_ATTEMPTS, gainDecision, parseEbur128, retryGain, volumeFilter } from "./loudness";
import { loadProject, mediaDir, mediaPath, updateProject } from "./media";
import { AUDIO_BITRATE, videoEncoderArgs } from "./quality";
import { loadMV } from "./store";
import type { EditOptions, EditPlan, EditSegment, LoudnessReport, LoudnessStats, MVResult, RenderInfo, RenderJob, Verification, VideoProject } from "./types";

const RATE = 48000;
/** Sai lệch thời lượng cho phép giữa hình, tiếng và bài hát (như Bokin Studio Music). */
const TOLERANCE = 0.1;

interface JobState extends RenderJob {
  abort: AbortController;
  /** Xong (thành công, lỗi hay huỷ) khi lần dựng kết thúc. */
  finished?: Promise<void>;
}

// Giữ trên globalThis để không mất khi Next.js nạp lại module lúc dev.
const g = globalThis as unknown as { __mvRenderJobs?: Map<string, JobState> };
const jobs = (g.__mvRenderJobs ??= new Map());

const publicJob = ({ abort: _abort, finished: _finished, ...job }: JobState): RenderJob => job;

/** Chờ lần dựng hiện tại của MV kết thúc, trả về trạng thái cuối. */
export async function waitRender(mvId: string): Promise<RenderJob | null> {
  await jobs.get(mvId)?.finished;
  return getJob(mvId);
}

export function getJob(mvId: string): RenderJob | null {
  const j = jobs.get(mvId);
  return j ? publicJob(j) : null;
}

export function isRendering(mvId: string): boolean {
  return jobs.get(mvId)?.status === "running";
}

export function cancelRender(mvId: string): RenderJob | null {
  const j = jobs.get(mvId);
  if (j?.status === "running") {
    j.abort.abort();
    j.status = "cancelled";
    j.stage = "Đã huỷ";
    j.finished_at = new Date().toISOString();
  }
  return j ? publicJob(j) : null;
}

// ---------- Hình ----------

/** Mọi thứ quyết định hình ảnh của một lần dựng (giống nhau cho mọi đoạn). */
export interface Look {
  w: number;
  h: number;
  fps: number;
  opts: EditOptions;
  /** Độ dài cả video (giây). */
  total: number;
  /** Đường dẫn ảnh logo (null = không có logo). */
  logo: string | null;
  title: string;
  textMode: TextMode;
  fontFile: string;
  /** Mờ dần từ đen ở đầu video (intro bật thì ít nhất 1,5 s như Bokin Studio Music). */
  fadeIn: number;
}

/** Đoạn có hiệu ứng phụ thuộc thời điểm (không dùng chung bản dựng với đoạn giống hệt ở chỗ khác). */
function isTimed(seg: EditSegment, look: Look): boolean {
  const s = seg.start_frame / look.fps;
  const e = s + seg.frames / look.fps;
  const { intro, logo } = look.opts;
  return (
    s < look.fadeIn ||
    e > look.total - look.opts.fadeOut ||
    s < introSpan(intro) ||
    (look.logo !== null && logo.start_seconds > 0 && s < logo.start_seconds + LOGO_FADE_IN)
  );
}

/**
 * filter_complex cho một đoạn. Input 0 là clip, input 1 (nếu có) là ảnh logo.
 * Phần chuẩn hoá khung hình theo đoạn; từ `setpts=PTS+start` trở đi mọi hiệu ứng dùng thời gian trên timeline.
 */
export function segmentGraph(seg: EditSegment, matrix: "bt601" | "bt709", look: Look): { graph: string; usesLogo: boolean } {
  const { w, h, fps, opts } = look;
  const start = seg.start_frame / fps;
  const dur = seg.frames / fps;
  const youtube = opts.quality === "youtube";
  const scaleFlags = youtube ? `:flags=lanczos:in_color_matrix=${matrix}:out_color_matrix=bt709:in_range=auto:out_range=tv` : "";
  let chain = `[0:v]setpts=PTS-STARTPTS,fps=${fps}`;
  if (opts.fit === "fill") chain += `,scale=${w}:${h}:force_original_aspect_ratio=increase${scaleFlags},crop=${w}:${h}`;
  else chain += `,scale=${w}:${h}:force_original_aspect_ratio=decrease:force_divisible_by=2${scaleFlags},pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`;
  chain += ",setsar=1";
  if (seg.flip) chain += ",hflip";
  chain += `,tpad=stop_mode=clone:stop_duration=${Math.ceil(dur) + 1}`;
  if (start > 0) chain += `,setpts=PTS+${start.toFixed(6)}/TB`;
  // Nền mờ trước logo: logo và chữ luôn sắc nét.
  chain += focusPull(opts.intro, fps, h, start, seg.frames);
  const logo = look.logo ? logoFilters(opts.logo, 1, w, h, fps, start, seg.frames) : null;
  if (logo) chain += logo.overlay;
  if (start < look.fadeIn && look.fadeIn > 0) chain += `,fade=t=in:st=0:d=${look.fadeIn.toFixed(3)}`;
  if (overlapsIntroText(opts.intro, start, dur)) chain += introText(opts.intro, look.title, w, h, look.textMode, look.fontFile);
  if (opts.fadeOut > 0 && start + dur > look.total - opts.fadeOut) {
    chain += `,fade=t=out:st=${Math.max(0, look.total - opts.fadeOut).toFixed(3)}:d=${opts.fadeOut.toFixed(3)}`;
  }
  if (start > 0) chain += ",setpts=PTS-STARTPTS";
  // Bộ mã hoá lấy thông tin màu từ khung hình: gắn BT.709 cho mọi khung (như preset YouTube của Bokin Studio Music).
  chain += ",format=yuv420p" + (youtube ? ",setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv" : "") + "[out]";
  return { graph: [...(logo ? [logo.prepare] : []), chain].join(";"), usesLogo: Boolean(logo) };
}

function segmentInputs(clipFile: string, inPoint: number, look: Look, usesLogo: boolean): string[] {
  return [...(inPoint > 0 ? ["-ss", inPoint.toFixed(3)] : []), "-i", clipFile, ...(usesLogo && look.logo ? ["-i", look.logo] : [])];
}

/** Chép font, viết file chữ / phụ đề intro vào thư mục làm việc (ffmpeg đọc bằng tên tương đối). */
async function prepareLook(mv: MVResult, project: VideoProject, plan: EditPlan, work: string): Promise<Look> {
  const opts: EditOptions = { ...project.options };
  const { w, h } = RENDER_SIZES[opts.size];
  const intro = opts.intro;
  const title = cleanText(intro.title || mv.idea.song_title || mv.idea.world_location);
  let textMode: TextMode = "ass";
  let fontFile = "";
  if (intro.enabled) {
    if (await hasFilter("subtitles")) textMode = "ass";
    else if (await hasFilter("drawtext")) textMode = "drawtext";
    else throw new FfmpegError("Bản ffmpeg này không vẽ được chữ (thiếu bộ lọc subtitles/drawtext) — tắt intro tiêu đề hoặc cài ffmpeg đầy đủ.");
    const source = project.font ? mediaPath(project.font.owner ?? mv.id, project.font.file) : defaultFont();
    if (!source) throw new FfmpegError("Không tìm thấy font cho intro — hãy tải một file font .ttf/.otf ở phần Intro.");
    const buf = await fs.readFile(source);
    const info = readFontInfo(buf);
    if (!info) throw new FfmpegError("Không đọc được file font của intro — hãy chọn font .ttf/.otf khác.");
    fontFile = `intro_font${path.extname(source).toLowerCase()}`;
    await fs.writeFile(path.join(work, fontFile), buf);
    const sub = { ...intro, subtitle: cleanText(intro.subtitle) };
    if (textMode === "ass") await fs.writeFile(path.join(work, "intro.ass"), introAss(sub, title, w, h, { name: info.fullName, bold: info.bold }), "utf8");
    else {
      await fs.writeFile(path.join(work, "intro_title.txt"), title, "utf8");
      await fs.writeFile(path.join(work, "intro_subtitle.txt"), sub.subtitle, "utf8");
    }
    opts.intro = sub;
  }
  return {
    w,
    h,
    fps: opts.fps,
    opts,
    total: plan.duration,
    logo: project.logo ? mediaPath(project.logo.owner ?? mv.id, project.logo.file) : null,
    title,
    textMode,
    fontFile,
    fadeIn: intro.enabled ? Math.max(opts.fadeIn, FADE_FROM_BLACK) : opts.fadeIn,
  };
}

// ---------- Tiếng ----------

/** Đo loudness / true peak (ebur128): metadata khung cuối ghi ra file tên tương đối trong thư mục làm việc. */
export async function measureLoudness(file: string, work: string, name: string, run: RunOptions = {}): Promise<LoudnessStats> {
  const frames = `${name}_ebur128_frames.txt`;
  const res = await ffmpegOrThrow(
    ["-hide_banner", "-nostdin", "-v", "info", "-i", path.resolve(file), "-map", "0:a:0", "-vn", "-sn", "-dn", "-af", `${EBUR128_FILTER},ametadata=mode=print:file=${frames}`, "-f", "null", "-"],
    "Đo âm lượng",
    { ...run, cwd: work },
  );
  let tail = "";
  try {
    const buf = await fs.readFile(path.join(work, frames));
    tail = buf.subarray(Math.max(0, buf.length - 4096)).toString("utf8");
  } catch {
    // tiếng ngắn hơn một khung 100 ms: chỉ có phần tổng kết
  } finally {
    await fs.rm(path.join(work, frames), { force: true });
  }
  return parseEbur128(tail, res.stderr);
}

interface AudioResult {
  file: string;
  report: LoudnessReport | null;
}

/** Chuẩn bị tiếng (chạy song song với phần dựng hình). `onStage` báo bước đang làm. */
async function prepareAudio(project: VideoProject, plan: EditPlan, work: string, signal: AbortSignal, onStage: (s: string) => void): Promise<AudioResult> {
  const opts = project.options;
  const audio = project.audio!;
  // 1. Bản lossless chuẩn: 48 kHz, stereo, 24-bit. Mono được nhân đôi nguyên mức (upmix mặc định của FFmpeg nhỏ hơn 3 dB).
  onStage("chuẩn bị");
  const lossless = path.join(work, "song.flac");
  const layout = audio.channels === 1 ? "pan=stereo|c0=c0|c1=c0," : "";
  await ffmpegOrThrow(
    ["-hide_banner", "-loglevel", "error", "-y", "-i", mediaPath(project.mv_id, audio.file), "-map", "0:a:0", "-vn", "-sn", "-dn", "-map_metadata", "-1",
      "-af", `${layout}aresample=${RATE},asetpts=N/SR/TB`, "-ac", "2", "-t", plan.duration.toFixed(6),
      "-c:a", "flac", "-sample_fmt", "s32", "-bits_per_raw_sample", "24", lossless],
    "Chuẩn bị tiếng",
    { signal },
  );
  const loud = opts.loudness;
  let report: LoudnessReport | null = null;
  let gain = 0;
  if (loud.enabled) {
    onStage("đo âm lượng");
    const before = await measureLoudness(lossless, work, "song", { signal });
    const d = gainDecision(before, loud);
    gain = d.applied_gain_db;
    report = { config: loud, before, ...d, aac_attempts: [], final_gain_db: gain };
  }
  const out = path.join(work, "audio.m4a");
  const fades: string[] = [];
  if (opts.fadeIn > 0) fades.push(`afade=t=in:st=0:d=${opts.fadeIn}`);
  if (opts.fadeOut > 0) fades.push(`afade=t=out:st=${Math.max(0, plan.duration - opts.fadeOut).toFixed(3)}:d=${opts.fadeOut}`);
  for (let attempt = 1; attempt <= (loud.enabled ? MAX_AAC_ATTEMPTS : 1); attempt++) {
    onStage(loud.enabled ? `mã hoá AAC lượt ${attempt}` : "mã hoá AAC");
    const filter = [...(loud.enabled ? [volumeFilter(gain)] : []), ...fades, "asetpts=N/SR/TB"].join(",");
    await ffmpegOrThrow(
      ["-hide_banner", "-loglevel", "error", "-y", "-i", lossless, "-af", filter, "-c:a", "aac", "-b:a", AUDIO_BITRATE[opts.quality], out],
      "Mã hoá tiếng AAC",
      { signal },
    );
    if (!loud.enabled || !report) break;
    onStage(`kiểm tra đỉnh AAC lượt ${attempt}/${MAX_AAC_ATTEMPTS}`);
    const measured = await measureLoudness(out, work, `aac_${attempt}`, { signal });
    let next: number | null;
    try {
      next = retryGain(measured.true_peak_dbtp, loud.true_peak_dbtp, gain, attempt);
    } catch (err) {
      report.aac_attempts.push({ attempt, gain_db: gain, ...measured, accepted: false });
      throw new FfmpegError((err as Error).message);
    }
    report.aac_attempts.push({ attempt, gain_db: gain, ...measured, accepted: next === null });
    if (next === null) break;
    gain = next;
    report.final_gain_db = gain;
  }
  return { file: out, report };
}

// ---------- Kiểm tra đầu ra ----------

async function decodeStats(file: string, map: string, signal: AbortSignal): Promise<{ frames: number; seconds: number }> {
  let frames = 0;
  let us = 0;
  await ffmpegOrThrow(["-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:1", "-i", file, "-map", map, "-f", "null", "-"], "Giải mã kiểm tra", {
    signal,
    onStdoutLine: (line) => {
      const f = /^frame=(\d+)/.exec(line);
      if (f) frames = Number(f[1]);
      const t = /^out_time_us=(\d+)/.exec(line);
      if (t) us = Number(t[1]);
    },
  });
  return { frames, seconds: us / 1e6 };
}

/** Giải mã toàn bộ hình và tiếng; đúng codec, đủ khung hình, lệch thời lượng ≤ 0,1 s. */
export async function verifyOutput(file: string, plan: EditPlan, signal: AbortSignal): Promise<Verification> {
  const info = await probe(file);
  const video = await decodeStats(file, "0:v:0", signal);
  const audio = await decodeStats(file, "0:a:0", signal);
  const videoSeconds = video.frames / plan.fps;
  const v: Verification = {
    target_seconds: plan.duration,
    video_seconds: Math.round(videoSeconds * 1000) / 1000,
    audio_seconds: Math.round(audio.seconds * 1000) / 1000,
    video_frames: video.frames,
    expected_frames: plan.total_frames,
    video_codec: info.video?.codec ?? "",
    audio_codec: info.audioCodec ?? "",
    passed: false,
  };
  v.passed =
    v.video_codec === "h264" &&
    v.audio_codec === "aac" &&
    v.video_frames === v.expected_frames &&
    Math.abs(videoSeconds - plan.duration) <= TOLERANCE + 1e-6 &&
    Math.abs(audio.seconds - plan.duration) <= TOLERANCE + 1e-6 &&
    Math.abs(videoSeconds - audio.seconds) <= TOLERANCE + 1e-6;
  return v;
}

// ---------- Công việc dựng ----------

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>, stop: () => boolean) {
  let next = 0;
  const worker = async () => {
    while (next < items.length && !stop()) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

function stampName(mv: MVResult): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const base =
    exportFileBase([mv])
      .replace(/[^a-z0-9_-]+/gi, "-")
      .slice(0, 100)
      .replace(/^[^a-z0-9]+/i, "") || "mv";
  return `${base}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.mp4`;
}

async function loadInputs(mvId: string) {
  if (!findFfmpeg().ok) throw new FfmpegError("Không tìm thấy ffmpeg — xem hướng dẫn trên trang.");
  const mv = await loadMV(mvId);
  if (!mv) throw new Error("Không tìm thấy MV.");
  // Thiết lập chung cho mọi MV + nhạc, clip, mốc đoạn riêng của MV này.
  const project = applyShared(await loadProject(mvId), await loadProject(SHARED_ID));
  const plan = buildEdit(editInputFrom(mv, project));
  return { mv, project, plan };
}

/** Bắt đầu dựng (chạy nền). Lỗi kiểm tra đầu vào được ném ra ngay. */
export async function startRender(mvId: string): Promise<RenderJob> {
  if (isRendering(mvId)) throw new FfmpegError("MV này đang được dựng — chờ xong hoặc huỷ trước.");
  const { mv, project, plan } = await loadInputs(mvId);
  if (!project.audio) throw new FfmpegError("Chưa tải bài hát lên.");
  if (!plan.segments.length) throw new FfmpegError("Chưa có clip nào để dựng.");

  const job: JobState = {
    id: `job_${Date.now().toString(36)}`,
    mv_id: mvId,
    status: "running",
    progress: 0,
    stage: "Chuẩn bị…",
    started_at: new Date().toISOString(),
    abort: new AbortController(),
  };
  jobs.set(mvId, job);
  job.finished = runJob(job, mv, project, plan);
  return publicJob(job);
}

async function runJob(job: JobState, mv: MVResult, project: VideoProject, plan: EditPlan) {
  const signal = job.abort.signal;
  const tmp = path.join(mediaDir(mv.id), `tmp-${job.id}`);
  const t0 = Date.now();
  try {
    await fs.mkdir(tmp, { recursive: true });
    const look = await prepareLook(mv, project, plan, tmp);
    const opts = look.opts;
    // Tiếng (FLAC → đo → AAC → kiểm tra đỉnh) chạy song song với phần dựng hình.
    let audioStage = "chuẩn bị";
    let audioFailed = false;
    const audioJob = prepareAudio(project, plan, tmp, signal, (st) => (audioStage = st));
    audioJob.then(
      () => (audioStage = "xong"),
      () => (audioFailed = true),
    );

    // Đoạn giống hệt nhau (cùng clip, cùng khúc, cùng độ dài, không có hiệu ứng theo thời điểm) chỉ dựng một lần.
    const keyOf = (s: EditSegment) => `${s.shot_no}|${s.in_point}|${s.frames}|${s.flip}|${isTimed(s, look) ? s.start_frame : ""}`;
    const unique = new Map<string, { seg: EditSegment; file: string }>();
    const order = plan.segments.map((s) => {
      const key = keyOf(s);
      if (!unique.has(key)) unique.set(key, { seg: s, file: `seg-${String(unique.size + 1).padStart(4, "0")}.mp4` });
      return unique.get(key)!.file;
    });
    const encoder = videoEncoderArgs(opts.quality, look.h, look.fps);
    let done = 0;
    const total = unique.size;
    const stage = () => (job.stage = `Dựng đoạn ${done}/${total} · tiếng: ${audioStage}`);
    stage();
    const threads = Math.max(1, Math.min(3, Math.floor(os.cpus().length / 2)));
    await pool(
      [...unique.values()],
      threads,
      async ({ seg, file }) => {
        const clip = project.clips[String(seg.shot_no)];
        const { graph, usesLogo } = segmentGraph(seg, clip.color_matrix ?? "bt709", look);
        await ffmpegOrThrow(
          ["-hide_banner", "-loglevel", "error", "-y", ...segmentInputs(mediaPath(mv.id, clip.file), seg.in_point, look, usesLogo),
            "-filter_complex", graph, "-map", "[out]", "-frames:v", String(seg.frames), "-an", "-sn", "-dn", "-map_metadata", "-1",
            ...encoder, "-video_track_timescale", String(look.fps * 1000), file],
          `Dựng đoạn cảnh #${seg.shot_no}`,
          { signal, cwd: tmp },
        );
        done++;
        job.progress = (done / total) * 0.9;
        stage();
      },
      () => signal.aborted || audioFailed,
    );
    if (signal.aborted) throw new FfmpegError("Đã huỷ.");
    job.stage = `Hoàn tất tiếng: ${audioStage}`;
    const audio = await audioJob;

    // Nối hình (stream copy, đường dẫn tương đối trong thư mục làm việc) + tiếng AAC đã kiểm tra.
    await fs.writeFile(path.join(tmp, "list.txt"), order.map((f) => `file '${f}'`).join("\n") + "\n", "utf8");
    job.stage = "Ghép hình với tiếng";
    const partial = path.join(tmp, "out.mp4");
    // Thông tin MP4 điền tự động từ gợi ý YouTube lúc dựng kịch bản (tên kênh, thể loại: thiết lập chung).
    const tags = mvTags(mv, opts.metadata);
    await ffmpegOrThrow(
      ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", "list.txt", "-i", audio.file,
        "-map", "0:v:0", "-map", "1:a:0", "-map_metadata", "-1", "-map_chapters", "-1", "-c:v", "copy", "-c:a", "copy",
        "-t", plan.duration.toFixed(6), ...metadataArgs(tags), "-movflags", "+faststart", partial],
      "Ghép video với nhạc",
      { signal, cwd: tmp },
    );
    job.progress = 0.94;

    job.stage = "Kiểm tra video (giải mã toàn bộ hình và tiếng)";
    const verification = await verifyOutput(partial, plan, signal);
    if (!verification.passed) {
      throw new FfmpegError(
        `Video xuất ra không đạt kiểm tra (${verification.video_frames}/${verification.expected_frames} khung hình, hình ${verification.video_seconds}s, tiếng ${verification.audio_seconds}s, cần ${plan.duration.toFixed(2)}s) — không công bố file.`,
      );
    }
    const outName = stampName(mv);
    await fs.rename(partial, mediaPath(mv.id, outName));
    const stat = await fs.stat(mediaPath(mv.id, outName));
    const output: RenderInfo = {
      file: outName,
      created_at: new Date().toISOString(),
      size: stat.size,
      duration: verification.video_seconds,
      resolution: `${look.w}x${look.h}`,
      segments: plan.segments.length,
      seconds_taken: Math.round((Date.now() - t0) / 1000),
      quality: opts.quality,
      loudness: audio.report,
      verification,
      branding: { logo: Boolean(look.logo), intro: opts.intro.enabled },
      tags,
      download_name: downloadName(tags.title),
    };
    await updateProject(mv.id, (p) => ({ ...p, renders: [output, ...p.renders] }));
    Object.assign(job, { status: "done", progress: 1, stage: "Xong", output, finished_at: new Date().toISOString() });
  } catch (err) {
    if (job.status === "running") {
      Object.assign(job, {
        status: signal.aborted ? "cancelled" : "error",
        stage: signal.aborted ? "Đã huỷ" : "Lỗi",
        error: signal.aborted ? undefined : (err as Error).message,
        finished_at: new Date().toISOString(),
      });
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Ảnh xem thử một khung hình ở giây `t` với logo / intro / màu như khi dựng (PNG, rộng 960 px). */
export async function previewFrame(mvId: string, t: number): Promise<Buffer> {
  const { mv, project, plan } = await loadInputs(mvId);
  if (!plan.segments.length) throw new FfmpegError("Chưa có clip nào để xem thử.");
  const time = Math.max(0, Math.min(plan.duration - 1 / plan.fps, t));
  const frame = Math.floor(time * plan.fps);
  const seg = plan.segments.find((s) => frame >= s.start_frame && frame < s.start_frame + s.frames) ?? plan.segments[0];
  const tmp = path.join(mediaDir(mvId), `tmp-preview-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`);
  await fs.mkdir(tmp, { recursive: true });
  try {
    const look = await prepareLook(mv, project, plan, tmp);
    const offsetFrames = frame - seg.start_frame;
    const one: EditSegment = { ...seg, start_frame: frame, frames: 1, in_point: seg.in_point + offsetFrames / plan.fps };
    const { graph, usesLogo } = segmentGraph(one, project.clips[String(seg.shot_no)].color_matrix ?? "bt709", look);
    const out = path.join(tmp, "preview.png");
    await ffmpegOrThrow(
      ["-hide_banner", "-loglevel", "error", "-y", ...segmentInputs(mediaPath(mvId, project.clips[String(seg.shot_no)].file), one.in_point, look, usesLogo),
        "-filter_complex", `${graph};[out]scale=960:-2[pv]`, "-map", "[pv]", "-frames:v", "1", out],
      "Xem thử khung hình",
      { cwd: tmp },
    );
    return await fs.readFile(out);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}
