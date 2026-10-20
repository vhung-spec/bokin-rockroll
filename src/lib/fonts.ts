// Font cho chữ intro: font người dùng tải lên, hoặc font đậm có tiếng Việt của máy (như default_font() của Bokin Studio Music).
// Đọc tên font từ bảng `name` của TrueType/OpenType để libass chọn đúng font trong thư mục làm việc.

import { existsSync } from "node:fs";
import path from "node:path";

export interface FontInfo {
  /** Tên đầy đủ (vd. "Segoe UI Bold"), libass so khớp được. */
  fullName: string;
  family: string;
  bold: boolean;
}

/** Font hệ thống có đủ dấu tiếng Việt, theo thứ tự ưu tiên (Windows như Bokin Studio Music, rồi Linux, macOS). */
export function defaultFont(): string | null {
  const windows = path.join(process.env.WINDIR ?? "C:\\Windows", "Fonts");
  const candidates = [
    ...["segoeuib.ttf", "arialbd.ttf", "tahomabd.ttf"].map((n) => path.join(windows, n)),
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/Library/Fonts/Arial Bold.ttf",
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

function decodeName(buf: Buffer, platform: number, start: number, length: number): string {
  if (platform === 3 || platform === 0) {
    let s = "";
    for (let i = 0; i + 1 < length; i += 2) s += String.fromCharCode(buf.readUInt16BE(start + i));
    return s;
  }
  return buf.toString("latin1", start, start + length);
}

/** Tên và độ đậm của font (font đầu tiên nếu là .ttc); null nếu không đọc được. */
export function readFontInfo(buf: Buffer): FontInfo | null {
  try {
    let base = 0;
    if (buf.toString("latin1", 0, 4) === "ttcf") base = buf.readUInt32BE(12);
    const tag = buf.readUInt32BE(base);
    if (![0x00010000, 0x4f54544f, 0x74727565].includes(tag)) return null; // TrueType, 'OTTO', 'true'
    const numTables = buf.readUInt16BE(base + 4);
    const tables: Record<string, number> = {};
    for (let i = 0; i < numTables; i++) {
      const rec = base + 12 + i * 16;
      tables[buf.toString("latin1", rec, rec + 4)] = buf.readUInt32BE(rec + 8);
    }
    const nameAt = tables["name"];
    if (nameAt === undefined) return null;
    const count = buf.readUInt16BE(nameAt + 2);
    const strings = nameAt + buf.readUInt16BE(nameAt + 4);
    const found: Record<number, { score: number; value: string }> = {};
    for (let i = 0; i < count; i++) {
      const r = nameAt + 6 + i * 12;
      const platform = buf.readUInt16BE(r);
      const language = buf.readUInt16BE(r + 4);
      const nameId = buf.readUInt16BE(r + 6);
      if (![1, 2, 4].includes(nameId)) continue;
      // Ưu tiên Windows tiếng Anh (Mỹ), rồi Windows bất kỳ, Unicode, Mac.
      const score = platform === 3 ? (language === 0x409 ? 4 : 3) : platform === 0 ? 2 : 1;
      if ((found[nameId]?.score ?? 0) >= score) continue;
      const value = decodeName(buf, platform, strings + buf.readUInt16BE(r + 10), buf.readUInt16BE(r + 8)).replace(/\0/g, "").trim();
      if (value) found[nameId] = { score, value };
    }
    const family = found[1]?.value;
    if (!family) return null;
    const sub = found[2]?.value ?? "";
    const os2 = tables["OS/2"];
    const weight = os2 !== undefined ? buf.readUInt16BE(os2 + 4) : /bold|black|heavy/i.test(sub) ? 700 : 400;
    return { family, fullName: found[4]?.value ?? `${family} ${sub}`.trim(), bold: weight >= 600 };
  } catch {
    return null;
  }
}
