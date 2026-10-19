// Lưu nhạc + clip video của từng MV (data/media/<mvId>/project.json và các file) — chỉ dùng phía server.

import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { detectBeats } from "./beats";
import { UserError } from "./errors";
import { DEFAULT_EDIT_OPTIONS, mergeEditOptions } from "./edit";
import { FONT_EXTENSIONS, LOGO_EXTENSIONS } from "./branding";
import { decodeMono, probe, renderWaveform } from "./ffmpeg";
import { MEDIA_DIR, SAFE_ID, withLock } from "./store";
import type { AudioTrack, EditOptions, MediaFile, VideoProject } from "./types";

export const VIDEO_EXT = [".mp4", ".mov", ".webm", ".mkv", ".m4v"];
export const AUDIO_EXT = [".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus"];
const MAX_CLIP_BYTES = 1024 ** 3;
const MAX_AUDIO_BYTES = 300 * 1024 ** 2;
const MAX_IMAGE_BYTES = 20 * 1024 ** 2;
const MAX_FONT_BYTES = 50 * 1024 ** 2;
const SAFE_FILE = /^[a-z0-9][a-z0-9._-]{0,150}$/i;
const SAMPLE_RATE = 11025;

/** Lỗi do file người dùng tải lên (trả 400). */
export class UploadError extends UserError {}

export function mediaDir(mvId: string): string {
  if (!SAFE_ID.test(mvId)) throw new UploadError("ID MV không hợp lệ");
  return path.join(/*turbopackIgnore: true*/ MEDIA_DIR(), mvId);
}

export function mediaPath(mvId: string, file: string): string {
  if (!SAFE_FILE.test(file)) throw new UploadError("Tên file không hợp lệ");
  return path.join(mediaDir(mvId), file);
}

const projectFile = (mvId: string) => path.join(mediaDir(mvId), "project.json");

function emptyProject(mvId: string): VideoProject {
  return { mv_id: mvId, audio: null, clips: {}, logo: null, font: null, options: mergeEditOptions(DEFAULT_EDIT_OPTIONS), renders: [], updated_at: new Date().toISOString() };
}

export async function loadProject(mvId: string): Promise<VideoProject> {
  try {
    const p = JSON.parse(await fs.readFile(projectFile(mvId), "utf8")) as VideoProject;
    return { ...emptyProject(mvId), ...p, options: mergeEditOptions(p.options) };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyProject(mvId);
    throw new Error(`Không đọc được dữ liệu dựng video: ${(err as Error).message}`);
  }
}

async function writeProject(p: VideoProject) {
  const file = projectFile(p.mv_id);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ ...p, updated_at: new Date().toISOString() }, null, 2) + "\n", "utf8");
  await fs.rename(tmp, file);
}

export function updateProject(mvId: string, fn: (p: VideoProject) => VideoProject | Promise<VideoProject>): Promise<VideoProject> {
  return withLock(`media:${mvId}`, async () => {
    const next = await fn(await loadProject(mvId));
    await writeProject(next);
    return loadProject(mvId);
  });
}

async function removeFile(mvId: string, file: string | undefined) {
  if (!file) return;
  await fs.rm(mediaPath(mvId, file), { force: true }).catch(() => undefined);
}

const stamp = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

function extOf(name: string, allowed: string[], kind: string): string {
  const ext = path.extname(name).toLowerCase();
  if (!allowed.includes(ext)) throw new UploadError(`${kind} cần có đuôi ${allowed.join(", ")} (file: ${name || "không tên"}).`);
  return ext;
}

/** Ghi luồng dữ liệu upload xuống đĩa, chặn nếu vượt dung lượng cho phép. */
async function receive(body: ReadableStream<Uint8Array>, dest: string, maxBytes: number): Promise<number> {
  let total = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      total += chunk.length;
      if (total > maxBytes) cb(new UploadError(`File quá lớn (tối đa ${Math.round(maxBytes / 1024 ** 2)} MB).`));
      else cb(null, chunk);
    },
  });
  await fs.mkdir(path.dirname(dest), { recursive: true });
  try {
    await pipeline(Readable.fromWeb(body as import("node:stream/web").ReadableStream<Uint8Array>), limit, createWriteStream(dest));
  } catch (err) {
    await fs.rm(dest, { force: true }).catch(() => undefined);
    throw err;
  }
  if (!total) {
    await fs.rm(dest, { force: true });
    throw new UploadError("File rỗng.");
  }
  return total;
}

/** Ước tính nhịp + phách đầu tiên từ file nhạc. */
async function analyzeBeats(file: string, fixedBpm: number | null) {
  try {
    const samples = await decodeMono(file, SAMPLE_RATE);
    return detectBeats(samples, SAMPLE_RATE, fixedBpm);
  } catch {
    return null;
  }
}

export async function addAudio(mvId: string, name: string, body: ReadableStream<Uint8Array>): Promise<VideoProject> {
  const ext = extOf(name, AUDIO_EXT, "File nhạc");
  const id = stamp();
  const file = `song-${id}${ext}`;
  const abs = mediaPath(mvId, file);
  const size = await receive(body, abs, MAX_AUDIO_BYTES);
  try {
    const info = await probe(abs);
    if (!info.audio) throw new UploadError("File này không có âm thanh.");
    const beat = await analyzeBeats(abs, null);
    let waveform: string | undefined = `wave-${id}.png`;
    await renderWaveform(abs, mediaPath(mvId, waveform)).catch(() => (waveform = undefined));
    const audio: AudioTrack = {
      file,
      name,
      size,
      duration: info.duration,
      channels: info.channels ?? undefined,
      uploaded_at: new Date().toISOString(),
      bpm: beat && beat.confidence >= 0.15 ? beat.bpm : null,
      bpm_source: "auto",
      beat_offset: beat?.offset ?? 0,
      beat_confidence: beat?.confidence ?? 0,
      waveform,
    };
    return await updateProject(mvId, async (p) => {
      await removeFile(mvId, p.audio?.file);
      await removeFile(mvId, p.audio?.waveform);
      // Bài mới → các mốc đoạn đặt tay cho bài cũ không còn đúng.
      return { ...p, audio, options: { ...p.options, sectionStarts: null } };
    });
  } catch (err) {
    await removeFile(mvId, file);
    throw err;
  }
}

/** Đổi BPM (null = tự nhận lại) và tìm lại vị trí phách. */
export async function setBpm(mvId: string, bpm: number | null): Promise<VideoProject> {
  const p = await loadProject(mvId);
  if (!p.audio) throw new UploadError("Chưa tải bài hát.");
  const beat = await analyzeBeats(mediaPath(mvId, p.audio.file), bpm);
  return updateProject(mvId, (cur) => {
    if (!cur.audio) return cur;
    const audio: AudioTrack = bpm
      ? { ...cur.audio, bpm, bpm_source: "manual", beat_offset: beat?.offset ?? 0, beat_confidence: beat?.confidence ?? 0 }
      : {
          ...cur.audio,
          bpm: beat && beat.confidence >= 0.15 ? beat.bpm : null,
          bpm_source: "auto",
          beat_offset: beat?.offset ?? 0,
          beat_confidence: beat?.confidence ?? 0,
        };
    return { ...cur, audio };
  });
}

export async function addClip(mvId: string, shotNo: number, name: string, body: ReadableStream<Uint8Array>): Promise<VideoProject> {
  const ext = extOf(name, VIDEO_EXT, "Clip video");
  const file = `shot-${String(shotNo).padStart(2, "0")}-${stamp()}${ext}`;
  const abs = mediaPath(mvId, file);
  const size = await receive(body, abs, MAX_CLIP_BYTES);
  try {
    const info = await probe(abs);
    if (!info.video) throw new UploadError(`"${name}" không có hình ảnh video.`);
    const clip: MediaFile = {
      file,
      name,
      size,
      duration: info.duration,
      width: info.video.width,
      height: info.video.height,
      color_matrix: info.video.matrix,
      uploaded_at: new Date().toISOString(),
    };
    return await updateProject(mvId, async (p) => {
      await removeFile(mvId, p.clips[String(shotNo)]?.file);
      return { ...p, clips: { ...p.clips, [String(shotNo)]: clip } };
    });
  } catch (err) {
    await removeFile(mvId, file);
    throw err;
  }
}

/** Logo kênh (ảnh) hoặc font chữ cho intro. */
export async function addAsset(mvId: string, kind: "logo" | "font", name: string, body: ReadableStream<Uint8Array>): Promise<VideoProject> {
  const ext = extOf(name, kind === "logo" ? LOGO_EXTENSIONS : FONT_EXTENSIONS, kind === "logo" ? "Logo" : "Font chữ");
  const file = `${kind}-${stamp()}${ext}`;
  const abs = mediaPath(mvId, file);
  const size = await receive(body, abs, kind === "logo" ? MAX_IMAGE_BYTES : MAX_FONT_BYTES);
  try {
    let width: number | undefined;
    let height: number | undefined;
    if (kind === "logo") {
      const info = await probe(abs).catch(() => null);
      if (!info?.video) throw new UploadError(`"${name}" không phải ảnh đọc được.`);
      ({ width, height } = info.video);
    } else {
      const { readFontInfo } = await import("./fonts");
      if (!readFontInfo(await fs.readFile(abs))) throw new UploadError(`"${name}" không phải font TrueType/OpenType đọc được.`);
    }
    const asset: MediaFile = { file, name, size, duration: 0, width, height, uploaded_at: new Date().toISOString() };
    return await updateProject(mvId, async (p) => {
      await removeFile(mvId, p[kind]?.file);
      return { ...p, [kind]: asset };
    });
  } catch (err) {
    await removeFile(mvId, file);
    throw err;
  }
}

export function removeAsset(mvId: string, kind: "logo" | "font"): Promise<VideoProject> {
  return updateProject(mvId, async (p) => {
    await removeFile(mvId, p[kind]?.file);
    return { ...p, [kind]: null };
  });
}

export function removeClip(mvId: string, shotNo: number): Promise<VideoProject> {
  return updateProject(mvId, async (p) => {
    const clips = { ...p.clips };
    await removeFile(mvId, clips[String(shotNo)]?.file);
    delete clips[String(shotNo)];
    return { ...p, clips };
  });
}

export function removeAudio(mvId: string): Promise<VideoProject> {
  return updateProject(mvId, async (p) => {
    await removeFile(mvId, p.audio?.file);
    await removeFile(mvId, p.audio?.waveform);
    return { ...p, audio: null, options: { ...p.options, sectionStarts: null } };
  });
}

/** Đổi chỗ clip của hai cảnh (cảnh không có clip cũng được — tức là chuyển clip sang). */
export function swapClips(mvId: string, a: number, b: number): Promise<VideoProject> {
  return updateProject(mvId, (p) => {
    const clips = { ...p.clips };
    const ca = clips[String(a)];
    const cb = clips[String(b)];
    delete clips[String(a)];
    delete clips[String(b)];
    if (ca) clips[String(b)] = ca;
    if (cb) clips[String(a)] = cb;
    return { ...p, clips };
  });
}

export function setOptions(mvId: string, options: EditOptions): Promise<VideoProject> {
  return updateProject(mvId, (p) => ({ ...p, options }));
}

export function removeRender(mvId: string, file: string): Promise<VideoProject> {
  return updateProject(mvId, async (p) => {
    if (!p.renders.some((r) => r.file === file)) return p;
    await removeFile(mvId, file);
    return { ...p, renders: p.renders.filter((r) => r.file !== file) };
  });
}

/** Tổng dung lượng nhạc + clip + video đã dựng của MV. */
export function projectBytes(p: VideoProject): number {
  return (
    (p.audio?.size ?? 0) +
    (p.logo?.size ?? 0) +
    (p.font?.size ?? 0) +
    Object.values(p.clips).reduce((a, c) => a + c.size, 0) +
    p.renders.reduce((a, r) => a + r.size, 0)
  );
}
