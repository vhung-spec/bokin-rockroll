// Gọi Claude API với structured output (JSON schema), kiểm tra kết quả và tự retry một lần.

import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import type { Settings } from "./types";

// Các model hỗ trợ server-side fallback dạng "default" khi bị từ chối (refusal).
const FALLBACK_MODELS = new Set(["claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-5", "claude-fable-5-1"]);

let client: Anthropic | null = null;

export function hasCredentials(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

function getClient(): Anthropic {
  // API key đọc từ biến môi trường ANTHROPIC_API_KEY (file .env) — không hard-code.
  client ??= new Anthropic({ maxRetries: 4 });
  return client;
}

export class LLMError extends Error {
  constructor(
    message: string,
    readonly kind: "refusal" | "parse" | "truncated" | "api" | "auth" | "rate_limit" | "aborted",
  ) {
    super(message);
  }
}

export interface StructuredCall<T> {
  settings: Pick<Settings, "model" | "effort" | "useFallback">;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  validator: z.ZodType<T>;
  /** Kiểm tra thêm về nội dung (ví dụ đủ số cảnh). Trả về chuỗi lỗi để retry, hoặc null. */
  check?: (data: T) => string | null;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface StructuredResult<T> {
  data: T;
  usage: { input_tokens: number; output_tokens: number };
  attempts: number;
}

function describeApiError(err: unknown): LLMError {
  if (err instanceof Anthropic.APIUserAbortError) return new LLMError("Đã dừng yêu cầu.", "aborted");
  if (err instanceof Anthropic.AuthenticationError) return new LLMError("API key không hợp lệ — kiểm tra ANTHROPIC_API_KEY trong file .env.", "auth");
  if (err instanceof Anthropic.PermissionDeniedError) return new LLMError(`API key không có quyền dùng model này: ${err.message}`, "auth");
  if (err instanceof Anthropic.NotFoundError) return new LLMError(`Không tìm thấy model — kiểm tra tên model trong Cài đặt. (${err.message})`, "api");
  if (err instanceof Anthropic.RateLimitError) return new LLMError("Bị giới hạn tốc độ (rate limit) — hãy giảm số luồng song song hoặc thử lại sau.", "rate_limit");
  if (err instanceof Anthropic.BadRequestError) return new LLMError(`Yêu cầu không hợp lệ: ${err.message}`, "api");
  if (err instanceof Anthropic.APIConnectionError) return new LLMError("Không kết nối được tới Claude API — kiểm tra mạng.", "api");
  if (err instanceof Anthropic.APIError) return new LLMError(`Lỗi Claude API ${err.status ?? ""}: ${err.message}`, "api");
  return new LLMError((err as Error)?.message ?? String(err), "api");
}

/**
 * Gọi Claude một lần với output_config.format = JSON schema (structured output).
 * Nếu JSON không parse được, không đúng schema, bị cắt do max_tokens, hoặc `check` báo lỗi
 * thì retry thêm một lần, kèm mô tả lỗi để Claude sửa.
 */
export async function callStructured<T>(call: StructuredCall<T>): Promise<StructuredResult<T>> {
  const anthropic = getClient();
  const usage = { input_tokens: 0, output_tokens: 0 };
  let lastError: LLMError | null = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const retryNote = lastError
      ? `\n\nYOUR PREVIOUS ANSWER WAS REJECTED: ${lastError.message}\nReturn the complete JSON again, fixing this.`
      : "";
    const useFallback = call.settings.useFallback && FALLBACK_MODELS.has(call.settings.model);

    let message: Anthropic.Beta.BetaMessage;
    try {
      const stream = anthropic.beta.messages.stream(
        {
          model: call.settings.model,
          max_tokens: call.maxTokens ?? 64000,
          system: [{ type: "text", text: call.system, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: call.user + retryNote }],
          output_config: {
            effort: call.settings.effort,
            format: { type: "json_schema", schema: call.schema },
          },
          ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        },
        { signal: call.signal },
      );
      message = await stream.finalMessage();
    } catch (err) {
      throw describeApiError(err);
    }

    usage.input_tokens += message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0);
    usage.output_tokens += message.usage.output_tokens;

    if (message.stop_reason === "refusal") {
      const category = message.stop_details?.category ? ` (${message.stop_details.category})` : "";
      throw new LLMError(`Claude từ chối yêu cầu${category}. Hãy chỉnh lại ý tưởng/khung sườn rồi thử lại.`, "refusal");
    }

    const text = message.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    if (message.stop_reason === "max_tokens") {
      lastError = new LLMError("The output was cut off by max_tokens. Be more concise.", "truncated");
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      lastError = new LLMError(`Invalid JSON: ${(err as Error).message}`, "parse");
      continue;
    }
    const result = call.validator.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      lastError = new LLMError(`JSON does not match the schema: ${issues}`, "parse");
      continue;
    }
    const problem = call.check?.(result.data);
    if (problem) {
      lastError = new LLMError(problem, "parse");
      if (attempt < 2) continue;
      // Lần thứ hai vẫn chưa đạt: trả về dữ liệu, phần xử lý sau sẽ tự vá và cảnh báo.
    }
    return { data: result.data, usage, attempts: attempt };
  }
  throw new LLMError(`Không nhận được kết quả hợp lệ sau 2 lần thử: ${lastError?.message ?? "lỗi không rõ"}`, lastError?.kind ?? "parse");
}
