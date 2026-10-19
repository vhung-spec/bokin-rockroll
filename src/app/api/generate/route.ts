import { NextResponse } from "next/server";
import { createDrafts, generateMV, generationMode } from "@/lib/generate";
import { errorResponse, readJsonBody } from "@/lib/http";
import { zIdea, zTone } from "@/lib/schemas";
import { readSettings } from "@/lib/store";

/**
 * Sinh một MV từ một dòng ý tưởng. Client gọi lần lượt (có giới hạn song song) để chạy batch.
 * Ở chế độ claude.ai không gọi API mà tạo bản nháp: trả về { kind: "draft", draft }.
 */
export async function POST(req: Request) {
  try {
    const body = await readJsonBody<{ idea: unknown; tone?: unknown }>(req);
    const idea = zIdea.parse(body.idea);
    const tone = body.tone === undefined ? "default" : zTone.parse(body.tone);
    if (generationMode(await readSettings()) === "manual") {
      const [draft] = await createDrafts([idea], tone);
      return NextResponse.json({ kind: "draft", draft }, { status: 202 });
    }
    const mv = await generateMV(idea, { tone, signal: req.signal });
    return NextResponse.json(mv);
  } catch (err) {
    return errorResponse(err);
  }
}
