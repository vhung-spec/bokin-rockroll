import { NextResponse } from "next/server";
import { changeStyle, recheckMV, updateBible } from "@/lib/generate";
import { errorResponse, readJsonBody } from "@/lib/http";
import { zCharacters } from "@/lib/schemas";
import { deleteMV, loadMV } from "@/lib/store";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const mv = await loadMV(id);
    if (!mv) return NextResponse.json({ error: "Không tìm thấy MV." }, { status: 404 });
    return NextResponse.json(mv);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    await deleteMV(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Các thao tác trên cả MV: sửa Character Bible, đổi style, kiểm tra lại. */
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const body = await readJsonBody<{ action: string; characters?: unknown; saveAsSeriesCouple?: boolean; styleKey?: string }>(req);
    switch (body.action) {
      case "bible":
        return NextResponse.json(await updateBible(id, zCharacters.parse(body.characters), Boolean(body.saveAsSeriesCouple)));
      case "style":
        return NextResponse.json(await changeStyle(id, String(body.styleKey ?? "")));
      case "recheck":
        return NextResponse.json(await recheckMV(id));
      default:
        return NextResponse.json({ error: "action không hợp lệ" }, { status: 400 });
    }
  } catch (err) {
    return errorResponse(err);
  }
}
