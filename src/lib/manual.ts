// Chế độ thủ công: tạo yêu cầu để dán vào claude.ai và đọc lại câu trả lời (JSON) người dùng dán về.

import { z } from "zod";
import { zCharacter } from "./llmSchemas";

/** Ghép system prompt + nội dung + hướng dẫn định dạng thành MỘT tin nhắn để dán vào claude.ai. */
export function manualPrompt(system: string, user: string, schema: Record<string, unknown>, extra: string[] = []): string {
  return [
    system,
    "",
    "=====",
    "",
    user,
    "",
    "=====",
    "",
    "RESPONSE FORMAT — this request is pasted into a chat, not sent through the API, so follow this exactly:",
    "- Reply with ONE ```json code block that contains a single JSON object matching the JSON Schema below.",
    "- No text before or after the code block. Do not use an artifact, canvas or file — put the JSON directly in the chat.",
    "- Keep the {{ID}} placeholders literally (for example {{HE}}).",
    ...extra.map((e) => `- ${e}`),
    "",
    "JSON Schema:",
    JSON.stringify(schema),
  ].join("\n");
}

export class AnswerError extends Error {}

/** Lấy object JSON ra khỏi câu trả lời (bỏ ```json, chữ thừa, dấu phẩy thừa). */
export function extractJson(text: string): unknown {
  const t = text.replace(/```(?:json|JSON)?/g, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new AnswerError("Không tìm thấy JSON trong câu trả lời. Hãy copy toàn bộ câu trả lời của Claude (cả khối ```json).");
  }
  const body = t.slice(start, end + 1);
  try {
    return JSON.parse(body);
  } catch {
    // lỗi hay gặp khi copy: dấu phẩy thừa trước } hoặc ]
    try {
      return JSON.parse(body.replace(/,\s*([}\]])/g, "$1"));
    } catch (err) {
      throw new AnswerError(
        `JSON không hợp lệ (${(err as Error).message}). Có thể câu trả lời bị cắt giữa chừng — hãy bảo Claude "Write the complete JSON again in one code block" rồi dán lại.`,
      );
    }
  }
}

// ---------- Schema "dễ tính" cho câu trả lời dán tay (thiếu trường thì dùng mặc định) ----------

const str = (d = "") => z.preprocess((v) => (v == null ? d : String(v)), z.string());
const strList = z.preprocess((v) => (Array.isArray(v) ? v.map(String) : typeof v === "string" && v ? [v] : []), z.array(z.string()));
const nullableStr = z.preprocess((v) => (v == null || v === "" ? null : String(v)), z.string().nullable());

export const zShotLoose = z.object({
  shot_no: z.coerce.number().int(),
  shot_size: str("medium"),
  camera: str(""),
  characters_in_shot: strList,
  description_vi: str(""),
  prompt_core: z.string().min(10, "prompt_core quá ngắn"),
  audio: nullableStr,
  negative_extra: strList,
  transition_to_next: str("cut"),
  signature_shot: nullableStr,
  is_motion: z.preprocess((v) => v === true || v === "true", z.boolean()),
});

const listOf = <T extends z.ZodTypeAny>(item: T) => z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(item));

export const zGenerationLoose = z.object({
  character_bible: z.preprocess(
    (v) => (Array.isArray(v) ? v : v && typeof v === "object" && Array.isArray((v as { characters?: unknown }).characters) ? (v as { characters: unknown[] }).characters : []),
    z.array(zCharacter),
  ),
  story_arc: listOf(z.object({ section: str(""), beat_vi: str("") })),
  shots: z.array(zShotLoose).min(1, "không có cảnh nào"),
  thumbnail_prompt: str(""),
  youtube_titles: strList,
  youtube_description: str(""),
  editing_notes: listOf(z.object({ section: str(""), note_vi: str("") })),
});

/** Câu trả lời sinh lại một cảnh: chấp nhận {"shot": {...}} hoặc object cảnh trực tiếp. */
export const zShotAnswerLoose = z.preprocess((v) => (v && typeof v === "object" && "shot" in v ? (v as { shot: unknown }).shot : v), zShotLoose);

export function parseAnswer<T>(text: string, schema: z.ZodType<T>): T {
  const data = extractJson(text);
  const res = schema.safeParse(data);
  if (!res.success) {
    const issues = res.error.issues
      .slice(0, 4)
      .map((i) => `${i.path.join(".") || "(gốc)"}: ${i.message}`)
      .join("; ");
    throw new AnswerError(`Câu trả lời chưa đúng định dạng: ${issues}.`);
  }
  return res.data;
}
