import { NextResponse } from "next/server";
import { buildDraftPrompt } from "@/lib/generate";
import { errorResponse } from "@/lib/http";

/** Tạo yêu cầu để copy sang claude.ai. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { prompt, draft } = await buildDraftPrompt((await params).id);
    return NextResponse.json({ prompt, chars: prompt.length, shots: (draft.ctx as { plan: { shots: unknown[] } }).plan.shots.length });
  } catch (err) {
    return errorResponse(err);
  }
}
