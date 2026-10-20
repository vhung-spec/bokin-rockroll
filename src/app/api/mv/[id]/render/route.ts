import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/http";
import { cancelRender, getJob, startRender } from "@/lib/render";

type Ctx = { params: Promise<{ id: string }> };

/** Tiến độ dựng video gần nhất của MV. */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return NextResponse.json({ job: getJob(id) });
}

/** Bắt đầu dựng video (chạy nền — theo dõi bằng GET). */
export async function POST(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    return NextResponse.json({ job: await startRender(id) }, { status: 202 });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Huỷ lần dựng đang chạy. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return NextResponse.json({ job: cancelRender(id) });
}
