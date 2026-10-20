// Đọc dữ liệu của tool HaoHao (bản cho khách, không có API) — CHỈ ĐỌC, không bao giờ ghi vào thư mục của HaoHao. Chỉ dùng phía server.
// HaoHao lưu hàng đợi task trong <thư mục dữ liệu>/tasks.json (ghi file tạm rồi đổi tên nên không bao giờ đọc phải file dở).

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseHaoHaoTasks, type MuseSource, type MuseTask } from "./muse";

/** Thư mục dữ liệu mặc định của HaoHao (Electron userData). */
export function defaultHaoHaoDir(): string {
  const home = os.homedir();
  if (process.platform === "win32") return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "HaoHao");
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "HaoHao");
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "HaoHao");
}

export const haohaoDir = (setting: string | undefined) => setting?.trim() || defaultHaoHaoDir();

// Đọc lại tasks.json chỉ khi file đổi (app dò mỗi vài giây).
const cache = new Map<string, { mtime: number; size: number; tasks: MuseTask[] }>();

export async function readHaoHaoTasks(dir: string): Promise<MuseTask[]> {
  const file = path.join(/*turbopackIgnore: true*/ dir, "tasks.json");
  let st;
  try {
    st = await fs.stat(file);
  } catch {
    throw new Error(`Không thấy tasks.json của HaoHao trong "${dir}". Mở HaoHao một lần, hoặc chỉnh "Thư mục dữ liệu HaoHao" trong Cài đặt.`);
  }
  const hit = cache.get(file);
  if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return hit.tasks;
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (err) {
    throw new Error(`Không đọc được tasks.json của HaoHao: ${(err as Error).message}`);
  }
  const tasks = parseHaoHaoTasks(raw);
  cache.set(file, { mtime: st.mtimeMs, size: st.size, tasks });
  return tasks;
}

export function haohaoSource(dir: string): MuseSource {
  return { tasks: () => readHaoHaoTasks(dir) };
}

export interface HaoHaoInfo {
  dir: string;
  found: boolean;
  /** Số task video trong hàng đợi / lịch sử của HaoHao. */
  tasks: number | null;
  /** Thư mục HaoHao lưu video. */
  outputDir: string | null;
  outputIsDefault: boolean;
  error?: string;
}

/** Thư mục lưu video của HaoHao: chỉ lấy đúng trường outputDir trong user_config.json (file đó còn có token Facebook — không đọc gì khác). */
async function outputDirOf(dir: string): Promise<{ outputDir: string; outputIsDefault: boolean }> {
  let saved = "";
  try {
    const cfg = JSON.parse(await fs.readFile(path.join(/*turbopackIgnore: true*/ dir, "user_config.json"), "utf8")) as { outputDir?: unknown };
    if (typeof cfg.outputDir === "string") saved = cfg.outputDir.trim();
  } catch {
    // chưa có file cài đặt → thư mục mặc định
  }
  if (saved) return { outputDir: saved, outputIsDefault: false };
  const videos = process.platform === "darwin" ? "Movies" : "Videos";
  return { outputDir: path.join(os.homedir(), videos, "MuseStudioPro"), outputIsDefault: true };
}

export async function haohaoInfo(dir: string): Promise<HaoHaoInfo> {
  const found = await fs
    .stat(dir)
    .then((s) => s.isDirectory())
    .catch(() => false);
  if (!found) return { dir, found, tasks: null, outputDir: null, outputIsDefault: true, error: `Không thấy thư mục dữ liệu HaoHao "${dir}".` };
  const out = await outputDirOf(dir);
  try {
    return { dir, found, tasks: (await readHaoHaoTasks(dir)).length, ...out };
  } catch (err) {
    return { dir, found, tasks: null, ...out, error: (err as Error).message };
  }
}
