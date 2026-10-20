import { NextResponse } from "next/server";
import { parseExportJson } from "@/lib/exporters";
import { importMVs } from "@/lib/generate";
import { errorResponse } from "@/lib/http";
import { summarize } from "@/lib/store";

/** Nhập lại file JSON đã xuất từ công cụ (một hoặc nhiều MV). */
export async function POST(req: Request) {
  try {
    const text = await req.text();
    let mvs;
    try {
      mvs = parseExportJson(text);
    } catch {
      return NextResponse.json({ error: "File không phải JSON hợp lệ." }, { status: 400 });
    }
    if (!mvs.length) return NextResponse.json({ error: "Không tìm thấy MV nào trong file JSON." }, { status: 400 });
    const imported = await importMVs(mvs);
    return NextResponse.json(imported.map(summarize));
  } catch (err) {
    return errorResponse(err);
  }
}
