import { NextResponse } from "next/server";
import { z } from "zod";
import { applyShotAnswer, regenerateShot, shotRegenManualPrompt, updateShot } from "@/lib/generate";
import { AnswerError } from "@/lib/manual";
import { errorResponse, readJsonBody } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Sinh lại một cảnh (có thể kèm yêu cầu, ví dụ "góc máy khác").
 * Chế độ claude.ai: { manual: "prompt" } → trả về yêu cầu để copy; { answer } → áp dụng câu trả lời đã dán.
 */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const body = z
      .object({
        shot_no: z.number().int().min(1),
        instruction: z.string().max(500).optional(),
        manual: z.literal("prompt").optional(),
        answer: z.string().max(200_000).optional(),
      })
      .parse(await readJsonBody(req));
    if (body.manual === "prompt") {
      const prompt = await shotRegenManualPrompt(id, body.shot_no, body.instruction ?? "");
      return NextResponse.json({ prompt, chars: prompt.length });
    }
    if (body.answer !== undefined) return NextResponse.json(await applyShotAnswer(id, body.shot_no, body.answer));
    return NextResponse.json(await regenerateShot(id, body.shot_no, body.instruction ?? "", req.signal));
  } catch (err) {
    if (err instanceof AnswerError) return NextResponse.json({ error: err.message }, { status: 422 });
    return errorResponse(err);
  }
}

const zPatch = z.object({
  prompt_en: z.string().min(1).optional(),
  description_vi: z.string().optional(),
  camera: z.string().optional(),
  shot_size: z.string().optional(),
  negative_prompt: z.string().optional(),
  transition_to_next: z.string().optional(),
  lyric_line: z.string().nullable().optional(),
  resetEdit: z.boolean().optional(),
});

/** Sửa tay một cảnh. */
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const body = z.object({ shot_no: z.number().int().min(1), patch: zPatch }).parse(await readJsonBody(req));
    return NextResponse.json(await updateShot(id, body.shot_no, body.patch));
  } catch (err) {
    return errorResponse(err);
  }
}
