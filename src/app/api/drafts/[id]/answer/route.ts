import { NextResponse } from "next/server";
import { completeDraft } from "@/lib/generate";
import { errorResponse, readJsonBody } from "@/lib/http";
import { AnswerError } from "@/lib/manual";

/** Dán câu trả lời của claude.ai → MV hoàn chỉnh. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { answer } = await readJsonBody<{ answer?: string }>(req);
    if (!answer?.trim()) return NextResponse.json({ error: "Chưa dán câu trả lời." }, { status: 400 });
    return NextResponse.json(await completeDraft((await params).id, answer));
  } catch (err) {
    if (err instanceof AnswerError) return NextResponse.json({ error: err.message }, { status: 422 });
    return errorResponse(err);
  }
}
