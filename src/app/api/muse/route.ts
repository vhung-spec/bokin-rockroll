import { NextResponse } from "next/server";
import { UserError } from "@/lib/errors";
import { errorResponse, readJsonBody } from "@/lib/http";
import { ensureMuseWatch, forgetMuse, museTick, museView, sendToMuse } from "@/lib/museJobs";

// ?mv=<id> (GET và POST): chỉ trả tiến độ của MV đó (trang Ghép video của MV); không có = mọi MV.
const onlyMv = (req: Request) => new URL(req.url).searchParams.get("mv") ?? undefined;

/** Tiến độ tạo clip bằng Muse + tình trạng kết nối HaoHao. */
export async function GET(req: Request) {
  try {
    return NextResponse.json(await museView(onlyMv(req)));
  } catch (err) {
    return errorResponse(err);
  }
}

const shotList = (raw: unknown) => (Array.isArray(raw) ? raw.map(Number).filter((n) => Number.isInteger(n) && n > 0) : undefined);

/**
 * { action: "send", ids, shots?, onlyMissing? } → { text, count, reused, …, view } (text = chữ để dán vào HaoHao)
 * { action: "forget", id, shots? } · { action: "check" } (dò HaoHao ngay) → view
 */
export async function POST(req: Request) {
  try {
    const body = await readJsonBody<{ action: string; ids?: unknown; id?: unknown; shots?: unknown; onlyMissing?: boolean }>(req);
    switch (body.action) {
      case "send": {
        const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string") : [];
        if (ids.length > 1 && body.shots) throw new UserError("Chỉ chọn cảnh khi gửi một MV.");
        const result = await sendToMuse(ids, { shots: shotList(body.shots), onlyMissing: body.onlyMissing !== false });
        return NextResponse.json({ ...result, view: await museView(onlyMv(req)) });
      }
      case "forget":
        await forgetMuse(String(body.id ?? ""), shotList(body.shots));
        break;
      case "check":
        await museTick();
        ensureMuseWatch();
        break;
      default:
        throw new UserError("action không hợp lệ.");
    }
    return NextResponse.json(await museView(onlyMv(req)));
  } catch (err) {
    return errorResponse(err);
  }
}
