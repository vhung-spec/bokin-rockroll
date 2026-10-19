// Xuất/đọc XLSX bằng exceljs — chỉ dùng phía server.

import ExcelJS from "exceljs";
import { SHOT_COLUMNS, bibleText, sheetName, shotRows } from "./exporters";
import type { MVResult } from "./types";

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC8102E" } };
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" } };

function styleHeader(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: "middle", wrapText: true };
  });
}

/** Một file cho cả series: sheet "Tổng quan" + mỗi MV một sheet. */
export async function buildWorkbook(mvs: MVResult[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MV Prompt Studio";
  wb.created = new Date();

  const overview = wb.addWorksheet("Tổng quan");
  overview.columns = [
    { header: "mv_id", key: "mv_id", width: 8 },
    { header: "Sheet", key: "sheet", width: 24 },
    { header: "Tên bài", key: "song_title", width: 24 },
    { header: "Bối cảnh", key: "world_location", width: 30 },
    { header: "Chủ đề", key: "theme", width: 24 },
    { header: "Series", key: "series", width: 26 },
    { header: "Số cảnh", key: "shots", width: 9 },
    { header: "Tạo bằng", key: "generator", width: 12 },
    { header: "Chi phí API (USD)", key: "cost", width: 14 },
    { header: "Character Bible", key: "bible", width: 70 },
    { header: "Style preset", key: "style", width: 50 },
    { header: "Thumbnail prompt", key: "thumbnail", width: 60 },
    { header: "Gợi ý tiêu đề", key: "titles", width: 50 },
    { header: "Mô tả YouTube", key: "description", width: 60 },
    { header: "Ghi chú dựng phim", key: "notes", width: 60 },
  ];
  styleHeader(overview.getRow(1));

  const used = new Set<string>(["tổng quan"]);
  for (const mv of mvs) {
    const name = sheetName(`${mv.idea.id} ${mv.idea.song_title || mv.idea.world_location}`, used);
    overview.addRow({
      mv_id: mv.idea.id,
      sheet: name,
      song_title: mv.idea.song_title ?? "",
      world_location: mv.idea.world_location,
      theme: `${mv.theme_code} ${mv.theme.name}`,
      series: mv.idea.series ?? "",
      shots: mv.shots.length,
      generator: { claude: "Claude API", manual: "claude.ai", mock: "demo" }[mv.generator],
      cost: Number((mv.usage?.cost_usd ?? 0).toFixed(4)),
      bible: bibleText(mv),
      style: mv.style_text,
      thumbnail: mv.thumbnail_prompt,
      titles: mv.youtube_titles.map((t, i) => `${i + 1}. ${t}`).join("\n"),
      description: mv.youtube_description,
      notes: mv.editing_notes.map((n) => `${n.section}: ${n.note_vi}`).join("\n"),
    });

    const ws = wb.addWorksheet(name);
    ws.columns = SHOT_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
    styleHeader(ws.getRow(1));
    for (const r of shotRows(mv)) ws.addRow(r);
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.eachRow((row, i) => {
      if (i > 1) row.alignment = { vertical: "top", wrapText: true };
    });
  }
  overview.eachRow((row, i) => {
    if (i > 1) row.alignment = { vertical: "top", wrapText: true };
  });
  overview.views = [{ state: "frozen", ySplit: 1 }];

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (typeof v === "object") {
    if ("richText" in v && Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("");
    if ("text" in v && typeof v.text === "string") return v.text;
    if ("result" in v) return v.result == null ? "" : String(v.result);
    if (v instanceof Date) return v.toISOString();
  }
  return String(v);
}

/** Đọc sheet đầu tiên của file XLSX thành ma trận chuỗi. */
export async function readFirstSheet(data: ArrayBuffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const matrix: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    const values = row.values as ExcelJS.CellValue[];
    for (let c = 1; c < values.length; c++) cells[c - 1] = cellText(values[c]).trim();
    matrix.push(Array.from(cells, (x) => x ?? ""));
  });
  return matrix;
}
