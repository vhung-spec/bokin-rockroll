import { NextResponse } from "next/server";
import { UserError } from "@/lib/errors";
import { errorResponse, readJsonBody } from "@/lib/http";
import { museEngine } from "@/lib/museEngine";
import { ensureMuseWatch, forgetMuse, museTick, museView, recheckMuse, reimportMuse, sendToMuse } from "@/lib/museJobs";
import { readSettings } from "@/lib/store";

// ?mv=<id> (GET và POST): chỉ trả tiến độ của MV đó (trang Ghép video của MV); không có = mọi MV.
const onlyMv = (req: Request) => new URL(req.url).searchParams.get("mv") ?? undefined;

/** Tiến độ tạo clip bằng Muse + tình trạng Muse trong app / HaoHao. */
export async function GET(req: Request) {
  try {
    return NextResponse.json(await museView(onlyMv(req)));
  } catch (err) {
    return errorResponse(err);
  }
}

const shotList = (raw: unknown) => (Array.isArray(raw) ? raw.map(Number).filter((n) => Number.isInteger(n) && n > 0) : undefined);

async function engineMode() {
  if ((await readSettings()).museMode !== "gateway") {
    throw new UserError("Đang dùng cách dán tay vào HaoHao — chọn “Tự động (Muse trong app)” trong Cài đặt để dùng lệnh này.");
  }
  return museEngine();
}

/**
 * { action: "send", ids, shots?, onlyMissing? } → { sent, text, count, reused, …, view }
 * { action: "forget", id, shots? } · { action: "reimport", id, shots? } (nhận lại clip đã xong mà đưa vào MV lỗi)
 * { action: "recheck", id, shots? } (đọc lại phiên cũ của cảnh lỗi, không gửi lại)
 * { action: "check" } (dò ngay; Muse trong app: kiểm tra lại đăng nhập, chạy tiếp nếu đang dừng vì hết hạn mức)
 * { action: "login" } (mở Chrome của Muse để đăng nhập) → view
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
      case "reimport":
        await reimportMuse(String(body.id ?? ""), shotList(body.shots));
        break;
      case "recheck":
        await recheckMuse(String(body.id ?? ""), shotList(body.shots));
        break;
      case "login":
        void (await engineMode()).worker.login();
        break;
      case "check":
        if ((await readSettings()).museMode === "gateway") await (await engineMode()).worker.check();
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
