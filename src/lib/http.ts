// Tiện ích cho route handler: trả lỗi JSON thống nhất.

import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { LLMError } from "./llm";

export function errorResponse(err: unknown) {
  if (err instanceof LLMError) {
    const status = { auth: 401, rate_limit: 429, refusal: 422, aborted: 499, parse: 502, truncated: 502, api: 502 }[err.kind];
    return NextResponse.json({ error: err.message, kind: err.kind }, { status });
  }
  if (err instanceof ZodError) {
    const msg = err.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "(gốc)"}: ${i.message}`)
      .join("; ");
    return NextResponse.json({ error: `Dữ liệu không hợp lệ — ${msg}` }, { status: 400 });
  }
  const message = err instanceof Error ? err.message : String(err);
  const status = /không tìm thấy/i.test(message) ? 404 : 500;
  if (status === 500) console.error(err);
  return NextResponse.json({ error: message }, { status });
}

export async function readJsonBody<T = unknown>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new Error("Body phải là JSON hợp lệ.");
  }
}
