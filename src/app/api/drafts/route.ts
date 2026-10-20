import { NextResponse } from "next/server";
import { z } from "zod";
import { createDrafts } from "@/lib/generate";
import { errorResponse, readJsonBody } from "@/lib/http";
import { zIdea, zTone } from "@/lib/schemas";
import { listDrafts } from "@/lib/store";

export async function GET() {
  const drafts = await listDrafts();
  // Không gửi ngữ cảnh (lớn) về trình duyệt.
  return NextResponse.json(drafts.map(({ ctx, notes, ...d }) => ({ ...d, ready: Boolean(ctx), noteCount: notes?.length ?? 0 })));
}

/** Tạo bản nháp cho chế độ claude.ai (mỗi ý tưởng một bản nháp). */
export async function POST(req: Request) {
  try {
    const body = z.object({ ideas: z.array(zIdea).min(1).max(500), tone: zTone.optional() }).parse(await readJsonBody(req));
    const drafts = await createDrafts(body.ideas, body.tone ?? "default");
    return NextResponse.json(drafts);
  } catch (err) {
    return errorResponse(err);
  }
}
