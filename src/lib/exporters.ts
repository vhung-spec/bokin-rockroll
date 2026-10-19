// Xuất kết quả: CSV, Markdown, TXT, JSON, "Copy tất cả prompt". (XLSX nằm ở xlsx.ts — chỉ chạy phía server.)

import Papa from "papaparse";
import { formatTime } from "./structure";
import type { MVResult } from "./types";

export const EXPORT_FORMAT = "mv-prompt-studio";

export const SHOT_COLUMNS = [
  { key: "mv_id", header: "mv_id", width: 8 },
  { key: "shot_no", header: "Cảnh #", width: 7 },
  { key: "section", header: "Đoạn", width: 12 },
  { key: "time", header: "Thời gian", width: 12 },
  { key: "duration_sec", header: "Dài (s)", width: 8 },
  { key: "shot_size", header: "Cỡ cảnh", width: 14 },
  { key: "camera", header: "Máy quay", width: 22 },
  { key: "characters", header: "Nhân vật", width: 10 },
  { key: "description_vi", header: "Mô tả (VI)", width: 40 },
  { key: "prompt_en", header: "Prompt (EN)", width: 90 },
  { key: "negative_prompt", header: "Negative prompt", width: 40 },
  { key: "lyric_line", header: "Câu hát", width: 30 },
  { key: "transition_to_next", header: "Chuyển cảnh", width: 22 },
  { key: "signature_shot", header: "Signature shot", width: 22 },
  { key: "warnings", header: "Cảnh báo", width: 40 },
] as const;

export type ShotRow = Record<(typeof SHOT_COLUMNS)[number]["key"], string | number>;

export function shotRows(mv: MVResult): ShotRow[] {
  return mv.shots.map((s) => ({
    mv_id: mv.idea.id,
    shot_no: s.shot_no,
    section: s.section,
    time: `${formatTime(s.start_sec)}–${formatTime(s.start_sec + s.duration_sec)}`,
    duration_sec: s.duration_sec,
    shot_size: s.shot_size,
    camera: s.camera,
    characters: s.characters_in_shot.join(", "),
    description_vi: s.description_vi,
    prompt_en: s.prompt_en,
    negative_prompt: s.negative_prompt,
    lyric_line: s.lyric_line ?? "",
    transition_to_next: s.transition_to_next,
    signature_shot: s.signature_shot ?? "",
    warnings: mv.issues
      .filter((i) => i.shot_no === s.shot_no && i.severity !== "info")
      .map((i) => i.message_vi)
      .join(" | "),
  }));
}

const META_COLUMNS = ["song_title", "world_location", "year", "theme_code", "series"] as const;

export function toCsv(mvs: MVResult[]): string {
  const rows = mvs.flatMap((mv) =>
    shotRows(mv).map((r) => ({
      ...r,
      song_title: mv.idea.song_title ?? "",
      world_location: mv.idea.world_location,
      year: mv.year,
      theme_code: mv.theme_code,
      series: mv.idea.series ?? "",
    })),
  );
  const fields = [SHOT_COLUMNS[0].key, ...META_COLUMNS, ...SHOT_COLUMNS.slice(1).map((c) => c.key)];
  // BOM để Excel đọc đúng tiếng Việt UTF-8.
  return "﻿" + Papa.unparse({ fields: [...fields], data: rows.map((r) => fields.map((f) => (r as Record<string, unknown>)[f] ?? "")) });
}

/** Tất cả prompt, theo thứ tự MV → cảnh. Mặc định mỗi dòng một prompt; `blankLine` = cách nhau một dòng trống. */
export function allPrompts(mvs: MVResult[], opts: { blankLine?: boolean } = {}): string {
  const prompts = mvs.flatMap((mv) => mv.shots.map((s) => s.prompt_en.replace(/\s*\n\s*/g, " ").trim()));
  return prompts.join(opts.blankLine ? "\n\n" : "\n") + (opts.blankLine ? "\n" : "");
}

export function bibleText(mv: MVResult): string {
  return mv.character_bible.characters.map((c) => `${c.id}: ${c.description}`).join("\n");
}

function mdEscape(s: string) {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function toMarkdown(mvs: MVResult[]): string {
  const out: string[] = [];
  for (const mv of mvs) {
    const title = mv.idea.song_title || mv.idea.world_location;
    out.push(`# MV ${mv.idea.id} — ${title}`);
    out.push("");
    out.push(`- **Bối cảnh:** ${mv.idea.world_location} (năm ${mv.year})`);
    out.push(`- **Chủ đề:** ${mv.theme_code} ${mv.theme.name} — ${mv.theme.mood}`);
    if (mv.idea.series) out.push(`- **Series:** ${mv.idea.series}`);
    out.push(`- **Khung sườn:** ${mv.idea.outline}`);
    out.push(`- **Công cụ video:** ${mv.video_model} · ${mv.structure.total_shots} cảnh · clip ${mv.structure.clip_len}s`);
    if (mv.generator === "claude") out.push(`- **Chi phí Claude API:** $${(mv.usage?.cost_usd ?? 0).toFixed(4)}`);
    out.push("");
    out.push("## Character Bible");
    for (const c of mv.character_bible.characters) out.push(`- **${c.id}** (${c.role}): ${c.description}`);
    out.push("");
    out.push("## Style preset");
    out.push(mv.style_text);
    out.push("");
    out.push("## Storyboard");
    out.push("| # | Đoạn | Thời gian | Mô tả (VI) | Prompt (EN) |");
    out.push("|---|---|---|---|---|");
    for (const s of mv.shots) {
      out.push(
        `| ${s.shot_no} | ${s.section} | ${formatTime(s.start_sec)}–${formatTime(s.start_sec + s.duration_sec)} | ${mdEscape(s.description_vi)} | ${mdEscape(s.prompt_en)} |`,
      );
    }
    out.push("");
    out.push("## Thumbnail prompt");
    out.push(mv.thumbnail_prompt);
    out.push("");
    out.push("## Gợi ý tiêu đề YouTube");
    mv.youtube_titles.forEach((t, i) => out.push(`${i + 1}. ${t}`));
    out.push("");
    out.push("## Mô tả");
    out.push(mv.youtube_description);
    out.push("");
    out.push("## Ghi chú dựng phim");
    for (const n of mv.editing_notes) out.push(`- **${n.section}:** ${n.note_vi}`);
    out.push("");
    out.push("---");
    out.push("");
  }
  return out.join("\n");
}

export function toText(mvs: MVResult[]): string {
  const out: string[] = [];
  for (const mv of mvs) {
    out.push(`=== MV ${mv.idea.id} — ${mv.idea.song_title || mv.idea.world_location} ===`);
    out.push(`${mv.idea.world_location} | ${mv.theme_code} ${mv.theme.name}`);
    out.push("");
    out.push("CHARACTER BIBLE");
    out.push(bibleText(mv));
    out.push("");
    out.push(`STYLE: ${mv.style_text}`);
    out.push("");
    for (const s of mv.shots) {
      out.push(`[${s.shot_no}] ${s.section} ${formatTime(s.start_sec)}–${formatTime(s.start_sec + s.duration_sec)} — ${s.description_vi}`);
      out.push(s.prompt_en);
      if (s.negative_prompt) out.push(`Negative: ${s.negative_prompt}`);
      out.push("");
    }
    out.push(`THUMBNAIL: ${mv.thumbnail_prompt}`);
    out.push("");
    out.push("TIÊU ĐỀ:");
    mv.youtube_titles.forEach((t, i) => out.push(`${i + 1}. ${t}`));
    out.push("");
    out.push(`MÔ TẢ: ${mv.youtube_description}`);
    out.push("");
    out.push("GHI CHÚ DỰNG:");
    for (const n of mv.editing_notes) out.push(`- ${n.section}: ${n.note_vi}`);
    out.push("");
  }
  return out.join("\n");
}

export function toJson(mvs: MVResult[]): string {
  return JSON.stringify({ format: EXPORT_FORMAT, version: 1, exported_at: new Date().toISOString(), mvs }, null, 2);
}

/** Đọc file JSON đã xuất (hoặc một MV đơn lẻ / mảng MV). */
export function parseExportJson(text: string): MVResult[] {
  const data = JSON.parse(text);
  const list: unknown[] = Array.isArray(data) ? data : Array.isArray(data?.mvs) ? data.mvs : [data];
  return list.filter((m): m is MVResult => {
    const mv = m as MVResult;
    return Boolean(mv && typeof mv === "object" && mv.idea && Array.isArray(mv.shots) && mv.character_bible);
  });
}

/** Tên sheet Excel hợp lệ (≤31 ký tự, không chứa []:*?/\) và không trùng. */
export function sheetName(base: string, used: Set<string>): string {
  const clean = base.replace(/[[\]:*?/\\']/g, " ").replace(/\s+/g, " ").trim().slice(0, 31).trim() || "MV";
  let name = clean;
  let k = 2;
  while (used.has(name.toLowerCase())) {
    const suffix = ` (${k++})`;
    name = clean.slice(0, 31 - suffix.length).trim() + suffix;
  }
  used.add(name.toLowerCase());
  return name;
}

export function exportFileBase(mvs: MVResult[]): string {
  if (mvs.length === 1) {
    const mv = mvs[0];
    return `mv-${mv.idea.id}-${slug(mv.idea.song_title || mv.idea.world_location)}`;
  }
  const series = mvs[0]?.idea.series;
  return series && mvs.every((m) => m.idea.series === series) ? `series-${slug(series)}` : `mv-batch-${mvs.length}`;
}

export function slug(s: string): string {
  return (
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/đ/gi, "d")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50) || "mv"
  );
}
