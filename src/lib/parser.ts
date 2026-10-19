// Đọc bảng ý tưởng: dán từ Google Docs/Sheets (tab hoặc |), CSV, hoặc ma trận ô từ XLSX.

import Papa from "papaparse";
import type { IdeaRow, LocationLibrary, Tempo } from "./types";

export interface ParseResult {
  rows: IdeaRow[];
  warnings: string[];
  headerDetected: boolean;
  delimiter: "tab" | "pipe" | "comma" | "matrix";
}

type Field = keyof IdeaRow | "tempo_or_bpm";

/** Bỏ dấu tiếng Việt và ký tự không phải chữ/số để so khớp tiêu đề cột. */
export function normalizeKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9#]/g, "");
}

const HEADER_ALIASES: Record<Field, string[]> = {
  id: ["id", "stt", "so", "#", "no", "number", "mvid", "mv", "sothutu"],
  world_location: ["worldlocation", "world", "location", "boicanh", "diadiem", "thegioi", "setting", "worldlocationyear"],
  theme_code: ["themecode", "theme", "chude", "machude", "code"],
  theme_name: ["themename", "tenchude"],
  outline: ["outline", "khungsuon", "ytuong", "noidung", "cottruyen", "story", "idea", "mota", "description"],
  song_title: ["songtitle", "title", "tenbai", "tenbaihat", "song", "baihat"],
  duration_sec: ["duration", "durationsec", "thoiluong", "length", "giay", "thoigian"],
  bpm: ["bpm"],
  tempo: ["tempo", "nhip", "tocdo", "pacing"],
  tempo_or_bpm: ["bpmtempo", "tempobpm"],
  lyrics: ["lyrics", "loi", "loibaihat", "lyric", "loibai"],
  series: ["series", "loat", "seri", "bo"],
};

const POSITIONAL_AFTER_OUTLINE: Field[] = ["song_title", "duration_sec", "tempo_or_bpm", "lyrics", "series"];

function detectHeader(cells: string[]): Map<number, Field> | null {
  const map = new Map<number, Field>();
  cells.forEach((cell, i) => {
    const key = normalizeKey(cell);
    if (!key) return;
    for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [Field, string[]][]) {
      if (aliases.includes(key) && ![...map.values()].includes(field)) {
        map.set(i, field);
        return;
      }
    }
  });
  const fields = [...map.values()];
  const strong = fields.filter((f) => f === "world_location" || f === "outline" || f === "theme_code").length;
  return strong >= 2 ? map : null;
}

const THEME_CELL_RE = /^\s*(T\s*\d{1,3})\b\s*[-–:.|]?\s*(.*)$/i;

export function splitThemeCell(cell: string): { code: string; name?: string } {
  const m = cell.match(THEME_CELL_RE);
  if (!m) return { code: cell.trim().toUpperCase() };
  const num = m[1].replace(/\s+/g, "").slice(1);
  const code = `T${num.padStart(2, "0")}`;
  const name = m[2].trim();
  return name ? { code, name } : { code };
}

/** "180", "3:20", "3m20s", "200s", "3 phút 20" → giây */
export function parseDuration(value: string): number | undefined {
  const v = value.trim().toLowerCase();
  if (!v) return undefined;
  const mmss = v.match(/^(\d{1,2}):(\d{2})$/);
  if (mmss) return Number(mmss[1]) * 60 + Number(mmss[2]);
  const ms = v.match(/^(\d+)\s*(m|min|phut|phút|')\s*(\d+)?\s*(s|sec|giay|giây|")?$/);
  if (ms) return Number(ms[1]) * 60 + (ms[3] ? Number(ms[3]) : 0);
  const s = v.match(/^(\d+(?:\.\d+)?)\s*(s|sec|giay|giây)?$/);
  if (s) return Math.round(Number(s[1]));
  return undefined;
}

export function parseTempo(value: string): { tempo?: Tempo; bpm?: number } {
  const v = normalizeKey(value);
  if (!v) return {};
  const num = value.match(/(\d{2,3})/);
  if (num && /^\d{2,3}(bpm)?$/.test(v)) return { bpm: Number(num[1]) };
  if (/^(slow|cham|ballad)/.test(v)) return { tempo: "slow" };
  if (/^(fast|nhanh|upbeat)/.test(v)) return { tempo: "fast" };
  if (/^(mid|medium|vua|trungbinh|moderate)/.test(v)) return { tempo: "mid" };
  if (num) return { bpm: Number(num[1]) };
  return {};
}

function isSeparatorRow(cells: string[]) {
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c.trim()) || c.trim() === "");
}

function splitPipeLine(line: string): string[] {
  let cells = line.split("|").map((c) => c.trim());
  if (cells.length && cells[0] === "") cells = cells.slice(1);
  if (cells.length && cells[cells.length - 1] === "") cells = cells.slice(0, -1);
  return cells;
}

/** Chuyển văn bản dán vào thành ma trận ô. */
export function textToMatrix(text: string): { matrix: string[][]; delimiter: ParseResult["delimiter"] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const sample = lines.slice(0, 10);
  const tabs = sample.filter((l) => l.includes("\t")).length;
  const pipes = sample.filter((l) => l.includes("|")).length;
  if (tabs > 0 && tabs >= pipes) {
    const parsed = Papa.parse<string[]>(text.trim(), { delimiter: "\t", skipEmptyLines: true });
    return { matrix: parsed.data, delimiter: "tab" };
  }
  if (pipes > 0) {
    return { matrix: lines.map(splitPipeLine).filter((c) => !isSeparatorRow(c)), delimiter: "pipe" };
  }
  const parsed = Papa.parse<string[]>(text.trim(), { delimiter: ",", skipEmptyLines: true });
  return { matrix: parsed.data, delimiter: "comma" };
}

function findThemeColumn(matrix: string[][]): number {
  const width = Math.max(...matrix.map((r) => r.length));
  let best = -1;
  let bestScore = 0;
  for (let c = 0; c < width; c++) {
    const score = matrix.filter((r) => r[c] && /^\s*T\s*\d{1,3}\b/i.test(r[c])).length;
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return bestScore >= Math.ceil(matrix.length / 2) ? best : -1;
}

function positionalMap(matrix: string[][]): Map<number, Field> {
  const map = new Map<number, Field>();
  const themeCol = findThemeColumn(matrix);
  if (themeCol >= 1) {
    map.set(themeCol, "theme_code");
    map.set(themeCol - 1, "world_location");
    if (themeCol >= 2) map.set(themeCol - 2, "id");
    map.set(themeCol + 1, "outline");
    POSITIONAL_AFTER_OUTLINE.forEach((f, k) => map.set(themeCol + 2 + k, f));
    return map;
  }
  const firstIsId = matrix.filter((r) => /^\s*\d+\s*\.?\s*$/.test(r[0] ?? "")).length >= Math.ceil(matrix.length / 2);
  const order: Field[] = firstIsId
    ? ["id", "world_location", "theme_code", "outline", ...POSITIONAL_AFTER_OUTLINE]
    : ["world_location", "theme_code", "outline", ...POSITIONAL_AFTER_OUTLINE];
  order.forEach((f, i) => map.set(i, f));
  return map;
}

/** Ma trận ô → danh sách ý tưởng (dùng chung cho dán bảng, CSV, XLSX). */
export function matrixToIdeas(
  input: string[][],
  delimiter: ParseResult["delimiter"] = "matrix",
  defaults: { series?: string } = {},
): ParseResult {
  const matrix = input
    .map((r) => r.map((c) => (c == null ? "" : String(c)).trim()))
    .filter((r) => r.some((c) => c));
  const warnings: string[] = [];
  if (!matrix.length) return { rows: [], warnings: ["Không tìm thấy dòng dữ liệu nào."], headerDetected: false, delimiter };

  const header = detectHeader(matrix[0]);
  const body = header ? matrix.slice(1) : matrix;
  const map = header ?? positionalMap(body);

  const rows: IdeaRow[] = [];
  body.forEach((cells, idx) => {
    const row: IdeaRow = { id: "", world_location: "", theme_code: "", outline: "" };
    map.forEach((field, col) => {
      const value = cells[col] ?? "";
      if (!value) return;
      switch (field) {
        case "id":
          row.id = value.replace(/\.$/, "");
          break;
        case "theme_code": {
          const { code, name } = splitThemeCell(value);
          row.theme_code = code;
          if (name && !row.theme_name) row.theme_name = name;
          break;
        }
        case "duration_sec":
          row.duration_sec = parseDuration(value);
          if (row.duration_sec === undefined) warnings.push(`Dòng ${idx + 1}: không hiểu thời lượng "${value}".`);
          break;
        case "bpm":
        case "tempo":
        case "tempo_or_bpm": {
          const t = parseTempo(value);
          if (t.bpm) row.bpm = t.bpm;
          if (t.tempo) row.tempo = t.tempo;
          break;
        }
        case "theme_name":
          row.theme_name = value;
          break;
        default:
          (row as unknown as Record<string, string>)[field] = value;
      }
    });
    if (!row.id) row.id = String(idx + 1);
    if (!row.series && defaults.series) row.series = defaults.series;
    const missing = [
      !row.world_location && "world_location",
      !row.theme_code && "theme_code",
      !row.outline && "outline",
    ].filter(Boolean);
    if (missing.length) warnings.push(`Dòng ${row.id}: thiếu ${missing.join(", ")}.`);
    rows.push(row);
  });

  return { rows, warnings, headerDetected: Boolean(header), delimiter };
}

export function parseIdeaTable(text: string, defaults: { series?: string } = {}): ParseResult {
  const { matrix, delimiter } = textToMatrix(text);
  return matrixToIdeas(matrix, delimiter, defaults);
}

export function parseCsv(text: string, defaults: { series?: string } = {}): ParseResult {
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, "").trim(), { skipEmptyLines: true });
  return matrixToIdeas(parsed.data, "comma", defaults);
}

/** Năm của cảnh lấy từ world_location, ví dụ "Hollywood Boulevard Summer 1954" → 1954. */
export function extractYear(worldLocation: string): number | null {
  const m = worldLocation.match(/\b(19\d{2})\b/);
  return m ? Number(m[1]) : null;
}

/** Tìm địa điểm khớp dài nhất trong thư viện (theo tên hoặc alias). */
export function matchLocation(worldLocation: string, library: LocationLibrary): string | null {
  const hay = ` ${normalizeSpaces(worldLocation)} `;
  let best: { key: string; len: number } | null = null;
  for (const [key, loc] of Object.entries(library)) {
    for (const name of [key, ...(loc.aliases ?? [])]) {
      const needle = normalizeSpaces(name);
      if (!needle) continue;
      if (hay.includes(` ${needle} `)) {
        if (!best || needle.length > best.len) best = { key, len: needle.length };
      }
    }
  }
  return best?.key ?? null;
}

function normalizeSpaces(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9À-ỹ]+/gi, " ")
    .trim();
}

/** Tên địa điểm rút gọn: bỏ năm và các từ chỉ mùa/thời điểm ở cuối. */
export function baseLocationName(worldLocation: string): string {
  return worldLocation
    .replace(/\b(19|20)\d{2}\b/g, "")
    .replace(/\b(summer|winter|spring|autumn|fall|night|nights|day|evening|morning|sunset|dawn)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
