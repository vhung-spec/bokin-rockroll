import { NextResponse } from "next/server";
import { latestPerIdea } from "@/lib/duplicates";
import { exportFileBase, allPrompts, toCsv, toJson, toMarkdown, toText } from "@/lib/exporters";
import { errorResponse } from "@/lib/http";
import { listMVs, loadMV } from "@/lib/store";
import { buildWorkbook } from "@/lib/xlsx";
import type { MVResult } from "@/lib/types";

const FORMATS = {
  csv: { ext: "csv", type: "text/csv; charset=utf-8" },
  xlsx: { ext: "xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  md: { ext: "md", type: "text/markdown; charset=utf-8" },
  txt: { ext: "txt", type: "text/plain; charset=utf-8" },
  json: { ext: "json", type: "application/json; charset=utf-8" },
  prompts: { ext: "txt", type: "text/plain; charset=utf-8" },
} as const;
type Format = keyof typeof FORMATS;

const byIdeaId = (a: MVResult, b: MVResult) =>
  (Number(a.idea.id) || 0) - (Number(b.idea.id) || 0) || a.idea.id.localeCompare(b.idea.id) || a.created_at.localeCompare(b.created_at);

/**
 * GET /api/export?format=xlsx&ids=mv_a,mv_b
 * GET /api/export?format=xlsx&series=<tên series>   (cả series, mỗi MV một sheet)
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const format = (url.searchParams.get("format") ?? "xlsx") as Format;
    if (!(format in FORMATS)) return NextResponse.json({ error: "Định dạng không hỗ trợ." }, { status: 400 });

    let mvs: MVResult[];
    const ids = url.searchParams.get("ids");
    const series = url.searchParams.get("series");
    if (ids) {
      const loaded = await Promise.all(ids.split(",").filter(Boolean).map((id) => loadMV(id)));
      mvs = loaded.filter((m): m is MVResult => Boolean(m));
    } else if (series !== null) {
      mvs = latestPerIdea((await listMVs()).filter((m) => (m.idea.series ?? "") === series)).sort(byIdeaId);
    } else {
      return NextResponse.json({ error: "Thiếu ids hoặc series." }, { status: 400 });
    }
    if (!mvs.length) return NextResponse.json({ error: "Không tìm thấy MV nào để xuất." }, { status: 404 });

    let body: string | Buffer;
    switch (format) {
      case "csv":
        body = toCsv(mvs);
        break;
      case "xlsx":
        body = await buildWorkbook(mvs);
        break;
      case "md":
        body = toMarkdown(mvs);
        break;
      case "txt":
        body = toText(mvs);
        break;
      case "json":
        body = toJson(mvs);
        break;
      case "prompts":
        body = allPrompts(mvs);
        break;
    }
    const { ext, type } = FORMATS[format];
    const filename = `${exportFileBase(mvs)}${format === "prompts" ? "-prompts" : ""}.${ext}`;
    return new Response(new Uint8Array(typeof body === "string" ? Buffer.from(body, "utf8") : body), {
      headers: {
        "Content-Type": type,
        "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
