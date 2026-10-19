// Gọi Claude API với structured output (JSON schema), kiểm tra kết quả và tự retry một lần.

import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { callCost, emptyUsage } from "./cost";
import type { ModelPrice, Settings, Usage } from "./types";

// Các model hỗ trợ server-side fallback dạng "default" khi bị từ chối (refusal).
const FALLBACK_MODELS = new Set(["claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-5", "claude-fable-5-1"]);

let client: Anthropic | null = null;
let clientKey: string | undefined;

export function hasCredentials(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

function getClient(): Anthropic {
  // API key đọc từ biến môi trường ANTHROPIC_API_KEY (file .env / .env.local hoặc nhập trong Cài đặt) — không hard-code.
  const key = process.env.ANTHROPIC_API_KEY;
  if (!client || clientKey !== key) {
    client = new Anthropic({ maxRetries: 4 });
    clientKey = key;
  }
  return client;
}

/** Kiểm tra API key + quyền dùng model (không tốn token). */
export async function testConnection(model: string): Promise<{ ok: true; model: string } | { ok: false; error: string }> {
  try {
    const info = await getClient().models.retrieve(model);
    return { ok: true, model: info.display_name ?? info.id };
  } catch (err) {
    return { ok: false, error: describeApiError(err).message };
  }
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
  /** Giá của model đang gọi (để quy đổi ra tiền). */
  price?: ModelPrice;
}

export interface StructuredResult<T> {
  data: T;
  usage: Usage;
  attempts: number;
}

function describeApiError(err: unknown): LLMError {
  if (err instanceof Anthropic.APIUserAbortError) return new LLMError("Đã dừng yêu cầu.", "aborted");
  if (err instanceof Anthropic.AuthenticationError) return new LLMError("API key không hợp lệ hoặc đã bị thu hồi — kiểm tra lại key trong Cài đặt.", "auth");
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
  const usage = emptyUsage();
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

    const u = {
      input_tokens: message.usage.input_tokens,
      output_tokens: message.usage.output_tokens,
      cache_creation_input_tokens: message.usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: message.usage.cache_read_input_tokens ?? 0,
    };
    usage.input_tokens += u.input_tokens;
    usage.output_tokens += u.output_tokens;
    usage.cache_creation_input_tokens! += u.cache_creation_input_tokens;
    usage.cache_read_input_tokens! += u.cache_read_input_tokens;
    usage.requests! += 1;
    const cost = callCost(u, call.price);
    if (cost === null) usage.cost_unknown = true;
    else usage.cost_usd! += cost;

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
