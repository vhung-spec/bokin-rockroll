import { errorResponse } from "@/lib/http";
import { previewFrame } from "@/lib/render";

type Ctx = { params: Promise<{ id: string }> };

/** Ảnh xem thử một khung hình (?t=giây) với logo / intro / màu như khi dựng — dùng tuỳ chọn đã lưu. */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const t = Number(new URL(req.url).searchParams.get("t") ?? 0);
    const png = await previewFrame(id, Number.isFinite(t) ? t : 0);
    return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
