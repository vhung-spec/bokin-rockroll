import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/http";
import { matrixToIdeas, parseCsv, parseIdeaTable } from "@/lib/parser";
import { readFirstSheet } from "@/lib/xlsx";

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Đọc bảng ý tưởng.
 * - JSON { text, series? }: văn bản dán từ Google Docs/Sheets (tab hoặc |).
 * - multipart/form-data { file, series? }: file .csv / .tsv / .txt / .xlsx.
 */
export async function POST(req: Request) {
  try {
    const type = req.headers.get("content-type") ?? "";
    if (type.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      const series = String(form.get("series") ?? "").trim() || undefined;
      if (!(file instanceof File)) return NextResponse.json({ error: "Chưa chọn file." }, { status: 400 });
      if (file.size > MAX_BYTES) return NextResponse.json({ error: "File quá lớn (tối đa 5 MB)." }, { status: 400 });
      const name = file.name.toLowerCase();
      if (name.endsWith(".xlsx")) {
        const matrix = await readFirstSheet(await file.arrayBuffer());
        return NextResponse.json(matrixToIdeas(matrix, "matrix", { series }));
      }
      if (name.endsWith(".xls")) {
        return NextResponse.json({ error: "Định dạng .xls cũ chưa được hỗ trợ — hãy lưu lại thành .xlsx hoặc .csv." }, { status: 400 });
      }
      const text = await file.text();
      return NextResponse.json(name.endsWith(".csv") ? parseCsv(text, { series }) : parseIdeaTable(text, { series }));
    }
    const body = (await req.json()) as { text?: string; series?: string };
    if (!body.text?.trim()) return NextResponse.json({ error: "Chưa có nội dung để đọc." }, { status: 400 });
    return NextResponse.json(parseIdeaTable(body.text, { series: body.series?.trim() || undefined }));
  } catch (err) {
    return errorResponse(err);
  }
}
