import { NextResponse } from "next/server";
import { SHARED_ID } from "@/lib/edit";
import { UserError } from "@/lib/errors";
import { errorResponse, readJsonBody } from "@/lib/http";
import { addAsset, loadProject, removeAsset, setOptions } from "@/lib/media";
import { zEditOptions } from "@/lib/schemas";

/** Thiết lập dựng video dùng chung cho mọi MV: cách ghép, khung hình, chất lượng, âm lượng, logo, intro, thông tin MP4. */
export async function GET() {
  try {
    return NextResponse.json({ shared: await loadProject(SHARED_ID) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** { options } — mốc đoạn (sectionStarts) không lưu ở đây vì là riêng của từng bài. */
export async function PATCH(req: Request) {
  try {
    const body = await readJsonBody<{ options?: unknown }>(req);
    const options = zEditOptions.parse(body.options);
    return NextResponse.json({ shared: await setOptions(SHARED_ID, { ...options, sectionStarts: null }) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Tải logo kênh (?kind=logo&name=logo.png) hoặc font intro (?kind=font&name=font.ttf); thân request là nội dung file. */
export async function PUT(req: Request) {
  try {
    const url = new URL(req.url);
    const kind = url.searchParams.get("kind");
    if (kind !== "logo" && kind !== "font") throw new UserError("kind phải là logo hoặc font.");
    if (!req.body) throw new UserError("Chưa có nội dung file.");
    return NextResponse.json({ shared: await addAsset(SHARED_ID, kind, (url.searchParams.get("name") ?? "").slice(0, 200), req.body) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: Request) {
  try {
    const kind = new URL(req.url).searchParams.get("kind");
    if (kind !== "logo" && kind !== "font") throw new UserError("kind phải là logo hoặc font.");
    return NextResponse.json({ shared: await removeAsset(SHARED_ID, kind) });
  } catch (err) {
    return errorResponse(err);
  }
}
