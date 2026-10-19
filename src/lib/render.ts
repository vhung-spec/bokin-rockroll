// Dựng MV hoàn chỉnh bằng ffmpeg: cắt từng đoạn theo kế hoạch → nối lại → ghép nhạc. Chạy nền, có tiến độ và nút huỷ.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { RENDER_SIZES, buildEdit, editInputFrom } from "./edit";
import { exportFileBase } from "./exporters";
import { FfmpegError, ffmpegOrThrow, findFfmpeg, probe } from "./ffmpeg";
import { loadProject, mediaDir, mediaPath, updateProject } from "./media";
import { loadMV } from "./store";
import type { EditOptions, EditPlan, EditSegment, MVResult, RenderInfo, RenderJob, VideoProject } from "./types";

interface JobState extends RenderJob {
  abort: AbortController;
}

// Giữ trên globalThis để không mất khi Next.js nạp lại module lúc dev.
const g = globalThis as unknown as { __mvRenderJobs?: Map<string, JobState> };
const jobs = (g.__mvRenderJobs ??= new Map());

const publicJob = ({ abort: _abort, ...job }: JobState): RenderJob => job;

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

/** Bộ lọc hình cho một đoạn: chuẩn khung hình, lật, kéo dài khung cuối nếu clip hụt, mờ dần đầu/cuối. */
export function segmentFilter(seg: EditSegment, opts: EditOptions, fade: { in: boolean; out: boolean }): string {
  const { w, h } = RENDER_SIZES[opts.size];
  const fps = opts.fps;
  const dur = seg.frames / fps;
  const f = [`fps=${fps}`];
  if (opts.fit === "fill") f.push(`scale=${w}:${h}:force_original_aspect_ratio=increase`, `crop=${w}:${h}`);
  else f.push(`scale=${w}:${h}:force_original_aspect_ratio=decrease:force_divisible_by=2`, `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`);
  f.push("setsar=1");
  if (seg.flip) f.push("hflip");
  f.push(`tpad=stop_mode=clone:stop_duration=${Math.ceil(dur) + 1}`);
  if (fade.in && opts.fadeIn > 0) f.push(`fade=t=in:st=0:d=${Math.min(opts.fadeIn, dur / 2).toFixed(3)}`);
  if (fade.out && opts.fadeOut > 0) {
    const d = Math.min(opts.fadeOut, dur / 2);
    f.push(`fade=t=out:st=${(dur - d).toFixed(3)}:d=${d.toFixed(3)}`);
  }
  f.push("format=yuv420p");
  return f.join(",");
}

function segmentArgs(clipFile: string, seg: EditSegment, opts: EditOptions, fade: { in: boolean; out: boolean }, out: string): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    ...(seg.in_point > 0 ? ["-ss", seg.in_point.toFixed(3)] : []),
    "-i",
    clipFile,
    "-vf",
    segmentFilter(seg, opts, fade),
    "-frames:v",
    String(seg.frames),
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-g",
    String(opts.fps * 2),
    "-video_track_timescale",
    String(opts.fps * 1000),
    out,
  ];
}

function muxArgs(listFile: string, audioFile: string, plan: EditPlan, opts: EditOptions, out: string): string[] {
  const af: string[] = [];
  if (opts.fadeIn > 0) af.push(`afade=t=in:st=0:d=${opts.fadeIn}`);
  if (opts.fadeOut > 0) af.push(`afade=t=out:st=${Math.max(0, plan.duration - opts.fadeOut).toFixed(3)}:d=${opts.fadeOut}`);
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-nostats",
    "-progress",
    "pipe:1",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listFile,
    "-i",
    audioFile,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "copy",
    ...(af.length ? ["-af", af.join(",")] : []),
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-t",
    plan.duration.toFixed(3),
    "-movflags",
    "+faststart",
    out,
  ];
}

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>, signal: AbortSignal) {
  let next = 0;
  const worker = async () => {
    while (next < items.length && !signal.aborted) await fn(items[next++]);
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

/** Bắt đầu dựng (chạy nền). Lỗi kiểm tra đầu vào được ném ra ngay. */
export async function startRender(mvId: string): Promise<RenderJob> {
  if (isRendering(mvId)) throw new FfmpegError("MV này đang được dựng — chờ xong hoặc huỷ trước.");
  if (!findFfmpeg().ok) throw new FfmpegError("Không tìm thấy ffmpeg — xem hướng dẫn trên trang.");
  const mv = await loadMV(mvId);
  if (!mv) throw new Error("Không tìm thấy MV.");
  const project = await loadProject(mvId);
  if (!project.audio) throw new FfmpegError("Chưa tải bài hát lên.");
  const plan = buildEdit(editInputFrom(mv, project));
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
  void runJob(job, mv, project, plan);
  return publicJob(job);
}

async function runJob(job: JobState, mv: MVResult, project: VideoProject, plan: EditPlan) {
  const signal = job.abort.signal;
  const opts = project.options;
  const tmp = path.join(mediaDir(mv.id), `tmp-${job.id}`);
  const t0 = Date.now();
  try {
    await fs.mkdir(tmp, { recursive: true });
    // Đoạn giống hệt nhau (cùng clip, cùng khúc, cùng độ dài) chỉ cần dựng một lần.
    const last = plan.segments.length - 1;
    const keyOf = (s: EditSegment, i: number) => `${s.shot_no}|${s.in_point}|${s.frames}|${s.flip}|${i === 0}|${i === last}`;
    const unique = new Map<string, { seg: EditSegment; index: number; file: string }>();
    const order = plan.segments.map((s, i) => {
      const key = keyOf(s, i);
      if (!unique.has(key)) unique.set(key, { seg: s, index: i, file: `seg-${String(unique.size + 1).padStart(4, "0")}.mp4` });
      return unique.get(key)!.file;
    });

    let done = 0;
    const total = unique.size;
    job.stage = `Cắt đoạn 0/${total}`;
    const threads = Math.max(1, Math.min(3, Math.floor(os.cpus().length / 2)));
    await pool(
      [...unique.values()],
      threads,
      async ({ seg, index, file }) => {
        const clip = project.clips[String(seg.shot_no)];
        await ffmpegOrThrow(
          segmentArgs(mediaPath(mv.id, clip.file), seg, opts, { in: index === 0, out: index === last }, path.join(tmp, file)),
          `Cắt clip cảnh #${seg.shot_no}`,
          { signal },
        );
        done++;
        job.progress = (done / total) * 0.85;
        job.stage = `Cắt đoạn ${done}/${total}`;
      },
      signal,
    );
    if (signal.aborted) throw new FfmpegError("Đã huỷ.");

    // Danh sách nối (đường dẫn tương đối, nằm cùng thư mục với file danh sách).
    const listFile = path.join(tmp, "list.txt");
    await fs.writeFile(listFile, order.map((f) => `file '${f}'`).join("\n") + "\n", "utf8");
    job.stage = "Ghép nhạc và xuất file…";
    const outName = stampName(mv);
    const partial = path.join(tmp, "out.mp4");
    await ffmpegOrThrow(muxArgs(listFile, mediaPath(mv.id, project.audio!.file), plan, opts, partial), "Ghép video với nhạc", {
      signal,
      onStdoutLine: (line) => {
        const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
        if (m) job.progress = 0.85 + 0.15 * Math.min(1, Number(m[1]) / 1e6 / plan.duration);
      },
    });
    await fs.rename(partial, mediaPath(mv.id, outName));
    const stat = await fs.stat(mediaPath(mv.id, outName));
    const info = await probe(mediaPath(mv.id, outName));
    const { w, h } = RENDER_SIZES[opts.size];
    const output: RenderInfo = {
      file: outName,
      created_at: new Date().toISOString(),
      size: stat.size,
      duration: info.duration,
      resolution: `${w}x${h}`,
      segments: plan.segments.length,
      seconds_taken: Math.round((Date.now() - t0) / 1000),
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
