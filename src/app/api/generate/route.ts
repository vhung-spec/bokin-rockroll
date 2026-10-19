import { NextResponse } from "next/server";
import { generateMV } from "@/lib/generate";
import { errorResponse, readJsonBody } from "@/lib/http";
import { zIdea, zTone } from "@/lib/schemas";

// Sinh một MV từ một dòng ý tưởng. Client gọi lần lượt (có giới hạn song song) để chạy batch.
export async function POST(req: Request) {
  try {
    const body = await readJsonBody<{ idea: unknown; tone?: unknown }>(req);
    const idea = zIdea.parse(body.idea);
    const tone = body.tone === undefined ? "default" : zTone.parse(body.tone);
    const mv = await generateMV(idea, { tone, signal: req.signal });
    return NextResponse.json(mv);
  } catch (err) {
    return errorResponse(err);
  }
}
