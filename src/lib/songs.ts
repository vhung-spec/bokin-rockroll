// Tự ghép bài hát: tìm file nhạc trùng tên bài trong thư mục nhạc (Cài đặt → Thư mục nhạc). Phần đọc thư mục chỉ dùng phía server.
// Tên file kiểu "Đèn Khuya - Rock Version.wav", "Anh Còn Nợ Em - Nam Metal Rock.WAV", "Sương Lạnh Chiều Đông1 - nam metal rock.wav".

import { promises as fs } from "node:fs";
import path from "node:path";
import { AUDIO_EXT } from "./media";

/** Bỏ dấu, chữ thường, chỉ giữ chữ / số (cách nhau một khoảng trắng). */
export function normSong(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Tên bài trong tên file: bỏ đuôi, phần sau " - " (phiên bản: Rock Version, Nam Metal Rock…), chữ "rock" / số dính ở cuối. */
export function songBase(fileName: string): string {
  const stem = fileName.replace(/\.[a-z0-9]{2,5}$/i, "");
  const head = stem.split(/\s+[-–—]\s+/)[0];
  return normSong(head)
    .replace(/(\s+(rock|version|ver|remix|cover|metal))+$/, "")
    .replace(/\d+$/, "")
    .trim();
}

/**
 * Độ khớp giữa tên bài của MV và một file nhạc (0–1): trùng cả tên file (kể cả phiên bản) > trùng tên bài > một bên chứa bên kia > nhiều từ chung.
 * Tên bài của MV ghi rõ phiên bản (vd. "Đèn Khuya - Nam Rock") thì chọn đúng file phiên bản đó.
 */
export function songScore(title: string, fileName: string): number {
  const t = normSong(title);
  if (!t) return 0;
  const full = normSong(fileName.replace(/\.[a-z0-9]{2,5}$/i, ""));
  if (t === full) return 1;
  const base = songBase(fileName);
  const tb = songBase(title);
  if (!base) return 0;
  if (t === base || tb === base) return 0.95;
  // Một bên chứa trọn bên kia — chỉ tính khi tên ngắn hơn có từ 2 chữ và phủ phần lớn tên dài (tránh "Đêm" khớp "Đêm lang thang").
  const pad = (s: string) => ` ${s} `;
  const [short, long] = t.length <= base.length ? [t, base] : [base, t];
  const words = (s: string) => s.split(" ").length;
  if (pad(long).includes(pad(short)) && words(short) >= 2 && words(short) / words(long) >= 0.6) return 0.8;
  const a = new Set(t.split(" "));
  const b = new Set(base.split(" "));
  const common = [...a].filter((w) => b.has(w)).length;
  const jaccard = common / new Set([...a, ...b]).size;
  return jaccard >= 0.6 ? 0.6 * jaccard : 0;
}

/** Chọn file khớp nhất (≥ 0.5); hai file khớp ngang nhau → lấy file đầu theo tên (báo lại để người dùng biết). */
export function pickSong(title: string, files: string[]): { file: string; score: number; ties: number } | null {
  const scored = files
    .map((file) => ({ file, score: songScore(title, path.basename(file)) }))
    .filter((x) => x.score >= 0.5)
    .sort((x, y) => y.score - x.score || x.file.localeCompare(y.file));
  if (!scored.length) return null;
  return { ...scored[0], ties: scored.filter((x) => x.score === scored[0].score).length - 1 };
}

/** Các file nhạc trong thư mục (cả thư mục con, tối đa 2 cấp). */
export async function listSongs(dir: string, depth = 2): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(/*turbopackIgnore: true*/ dir, { withFileTypes: true });
  } catch {
    throw new Error(`Không mở được thư mục nhạc "${dir}".`);
  }
  const out: string[] = [];
  for (const e of entries) {
    const p = path.join(/*turbopackIgnore: true*/ dir, e.name);
    if (e.isDirectory() && depth > 1) out.push(...(await listSongs(p, depth - 1).catch(() => [])));
    else if (e.isFile() && AUDIO_EXT.includes(path.extname(e.name).toLowerCase())) out.push(p);
  }
  return out;
}

/** Tìm bài cho MV trong thư mục nhạc; null nếu không có thư mục / không có tên bài / không thấy. */
export async function findSong(dir: string, title: string | undefined): Promise<{ file: string; score: number; ties: number } | null> {
  if (!dir.trim() || !title?.trim()) return null;
  return pickSong(title, await listSongs(dir.trim()));
}
