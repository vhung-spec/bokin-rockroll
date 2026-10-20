// Tìm và gọi ffmpeg (chỉ phía server). Thứ tự: biến môi trường FFMPEG_PATH → bản đi kèm (ffmpeg-static) → ffmpeg đã cài trên máy.

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { UserError } from "./errors";

export interface FfmpegInfo {
  ok: boolean;
  path: string | null;
  version: string | null;
  source: "env" | "bundled" | "system" | null;
}

let cached: FfmpegInfo | null = null;

function tryBinary(bin: string): string | null {
  try {
    const res = spawnSync(/*turbopackIgnore: true*/ bin, ["-hide_banner", "-version"], { encoding: "utf8", timeout: 15000, windowsHide: true });
    if (res.status !== 0) return null;
    return /ffmpeg version (\S+)/.exec(res.stdout)?.[1] ?? "?";
  } catch {
    return null;
  }
}

export function findFfmpeg(): FfmpegInfo {
  if (cached?.ok) return cached;
  const exe = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const candidates: { bin: string; source: FfmpegInfo["source"] }[] = [];
  if (process.env.FFMPEG_PATH) candidates.push({ bin: process.env.FFMPEG_PATH, source: "env" });
  const bundled = path.join(/*turbopackIgnore: true*/ process.cwd(), "node_modules", "ffmpeg-static", exe);
  if (existsSync(bundled)) candidates.push({ bin: bundled, source: "bundled" });
  candidates.push({ bin: "ffmpeg", source: "system" });
  for (const c of candidates) {
    const version = tryBinary(c.bin);
    if (version) return (cached = { ok: true, path: c.bin, version, source: c.source });
  }
  // Không lưu kết quả thất bại: người dùng có thể cài ffmpeg trong lúc app đang chạy.
  return { ok: false, path: null, version: null, source: null };
}

export class FfmpegError extends UserError {}

function requireFfmpeg(): string {
  const info = findFfmpeg();
  if (!info.ok || !info.path) {
    throw new FfmpegError("Không tìm thấy ffmpeg. Chạy lại file khởi động (để cài thư viện), hoặc cài ffmpeg từ https://ffmpeg.org rồi mở lại app.");
  }
  return info.path;
}

export interface RunOptions {
  signal?: AbortSignal;
  /** Thư mục làm việc của ffmpeg (font / file chữ được gọi bằng tên tương đối, không cần escape). */
  cwd?: string;
  /** Gọi với từng dòng ffmpeg in ra stdout (dùng với -progress pipe:1). */
  onStdoutLine?: (line: string) => void;
  /** Gom stdout thành Buffer (dùng khi giải mã âm thanh ra PCM). */
  collectStdout?: boolean;
  onSpawn?: (child: ChildProcess) => void;
}

export interface RunResult {
  code: number | null;
  stderr: string;
  stdout: Buffer;
}

export function runFfmpeg(args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const bin = requireFfmpeg();
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new FfmpegError("Đã huỷ."));
    const child = spawn(/*turbopackIgnore: true*/ bin, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, cwd: opts.cwd });
    opts.onSpawn?.(child);
    const out: Buffer[] = [];
    let err = "";
    let lineBuf = "";
    child.stdout.on("data", (chunk: Buffer) => {
      if (opts.collectStdout) out.push(chunk);
      if (opts.onStdoutLine) {
        lineBuf += chunk.toString("utf8");
        const lines = lineBuf.split(/\r?\n/);
        lineBuf = lines.pop() ?? "";
        lines.forEach(opts.onStdoutLine);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      err += chunk.toString("utf8");
      if (err.length > 200_000) err = err.slice(-100_000);
    });
    const onAbort = () => child.kill("SIGKILL");
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", (e) => {
      opts.signal?.removeEventListener("abort", onAbort);
      reject(new FfmpegError(`Không chạy được ffmpeg: ${e.message}`));
    });
    child.on("close", (code) => {
      opts.signal?.removeEventListener("abort", onAbort);
      if (opts.signal?.aborted) return reject(new FfmpegError("Đã huỷ."));
      resolve({ code, stderr: err, stdout: Buffer.concat(out) });
    });
  });
}

/** Chạy ffmpeg, báo lỗi (kèm vài dòng cuối của ffmpeg) nếu thất bại. */
export async function ffmpegOrThrow(args: string[], what: string, opts: RunOptions = {}): Promise<RunResult> {
  const res = await runFfmpeg(args, opts);
  if (res.code !== 0) {
    const tail = res.stderr.trim().split(/\r?\n/).slice(-4).join(" | ");
    throw new FfmpegError(`${what} thất bại: ${tail || `mã lỗi ${res.code}`}`);
  }
  return res;
}

const filterCache = new Map<string, boolean>();

/** Bản ffmpeg đang dùng có bộ lọc này không (vd. subtitles cần libass, drawtext cần libfreetype). */
export async function hasFilter(name: string): Promise<boolean> {
  const key = `${findFfmpeg().path}|${name}`;
  const known = filterCache.get(key);
  if (known !== undefined) return known;
  const res = await runFfmpeg(["-hide_banner", "-h", `filter=${name}`], { collectStdout: true });
  const text = res.stdout.toString("utf8") + res.stderr;
  const ok = res.code === 0 && new RegExp(`Filter ${name}\\b`).test(text);
  filterCache.set(key, ok);
  return ok;
}

export interface ProbeResult {
  duration: number;
  video: { width: number; height: number; fps: number | null; codec: string; matrix: "bt601" | "bt709" } | null;
  audio: boolean;
  audioCodec: string | null;
  channels: number | null;
}

function parseClock(s: string): number {
  const m = /(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(s);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : NaN;
}

/** Đọc thông tin file (thời lượng, khung hình, có tiếng không) từ ffmpeg -i. */
export function parseProbe(stderr: string): ProbeResult {
  const dur = /Duration:\s*([\d:.]+)/.exec(stderr);
  const streams = stderr.split(/\r?\n/).filter((l) => /^\s*Stream #\d+:\d+/.test(l));
  // Ảnh bìa (attached pic) trong file nhạc không tính là video.
  const videoLine = streams.find((l) => /: Video: /.test(l) && !/\(attached pic\)/.test(l));
  const audioLine = streams.find((l) => /: Audio: /.test(l));
  const size = videoLine ? /\b(\d{2,5})x(\d{2,5})\b/.exec(videoLine) : null;
  const fps = videoLine ? /(\d+(?:\.\d+)?) fps/.exec(videoLine) : null;
  const layout = audioLine ? /\b(mono|stereo|(\d+) channels|[2-7]\.[01](?:\(\w+\))?)\b/.exec(audioLine) : null;
  const channels = !layout ? null : layout[1] === "mono" ? 1 : layout[1] === "stereo" ? 2 : layout[2] ? Number(layout[2]) : Number(layout[1][0]) + Number(layout[1][2]);
  return {
    duration: dur ? parseClock(dur[1]) : NaN,
    video: size
      ? {
          width: Number(size[1]),
          height: Number(size[2]),
          fps: fps ? Number(fps[1]) : null,
          codec: /: Video: (\w+)/.exec(videoLine!)?.[1] ?? "",
          // Nguồn SD (BT.601) cần đổi ma trận màu khi xuất BT.709 (như Bokin Studio Music).
          matrix: /\b(bt470bg|smpte170m)\b/.test(videoLine!) ? "bt601" : "bt709",
        }
      : null,
    audio: Boolean(audioLine),
    audioCodec: audioLine ? (/: Audio: (\w+)/.exec(audioLine)?.[1] ?? "") : null,
    channels,
  };
}

export async function probe(file: string): Promise<ProbeResult> {
  const res = await runFfmpeg(["-hide_banner", "-i", file]);
  if (!/Stream #/.test(res.stderr)) throw new FfmpegError("File không đọc được (không phải video/âm thanh, hoặc bị hỏng).");
  const info = parseProbe(res.stderr);
  if (!Number.isFinite(info.duration) || info.duration <= 0) {
    // Một số file (webm từ trình duyệt…) không ghi thời lượng: giải mã hết để đo.
    const full = await runFfmpeg(["-hide_banner", "-i", file, "-f", "null", "-"]);
    const times = [...full.stderr.matchAll(/time=([\d:.]+)/g)];
    info.duration = times.length ? parseClock(times.at(-1)![1]) : NaN;
  }
  if (!Number.isFinite(info.duration) || info.duration <= 0) throw new FfmpegError("Không đo được thời lượng của file.");
  return info;
}

/** Giải mã âm thanh thành mẫu mono float32 (để ước tính nhịp). */
export async function decodeMono(file: string, sampleRate = 11025): Promise<Float32Array> {
  const res = await ffmpegOrThrow(["-hide_banner", "-loglevel", "error", "-i", file, "-vn", "-ac", "1", "-ar", String(sampleRate), "-f", "f32le", "-"], "Đọc âm thanh", {
    collectStdout: true,
  });
  const buf = res.stdout;
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4)).slice();
}

/** Vẽ dạng sóng âm ra ảnh PNG nền trong suốt. */
export async function renderWaveform(file: string, out: string, width = 1600, height = 120): Promise<void> {
  await ffmpegOrThrow(
    ["-hide_banner", "-loglevel", "error", "-y", "-i", file, "-filter_complex", `aformat=channel_layouts=mono,showwavespic=s=${width}x${height}:colors=0x23201c`, "-frames:v", "1", out],
    "Vẽ dạng sóng",
  );
}
