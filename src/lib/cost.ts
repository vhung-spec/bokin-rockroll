// Quy đổi token → tiền ($ và đ) và ước tính chi phí trước khi chạy.

import type { Effort, ModelPrice, Pricing, Usage } from "./types";

/** Bảng giá mặc định (USD / 1 triệu token) — sửa được trong data/pricing.json hoặc trang Cài đặt. */
export const DEFAULT_PRICING: Pricing = {
  usd_to_vnd: 26000,
  updated: "2026-10",
  note: "Giá Claude API (USD cho 1 triệu token). Kiểm tra lại tại https://platform.claude.com/pricing",
  models: {
    "claude-sonnet-5-5": { input: 2, output: 10, cache_write: 2.5, cache_read: 0.2 },
    "claude-opus-5-5": { input: 4, output: 20, cache_write: 5, cache_read: 0.2 },
    "claude-haiku-5-5": { input: 0.1, output: 0.5, cache_write: 0.125, cache_read: 0.01 },
  },
};

export interface CallUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

/** Chi phí (USD) của một lần gọi; null nếu model không có trong bảng giá. */
export function callCost(u: CallUsage, price: ModelPrice | undefined): number | null {
  if (!price) return null;
  return (
    (u.input_tokens * price.input +
      u.output_tokens * price.output +
      u.cache_creation_input_tokens * price.cache_write +
      u.cache_read_input_tokens * price.cache_read) /
    1_000_000
  );
}

export function emptyUsage(): Usage {
  return { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, requests: 0, cost_usd: 0 };
}

/** Cộng dồn usage (token + tiền) vào `into`. */
export function addUsage(into: Usage, add: Usage): Usage {
  into.input_tokens += add.input_tokens;
  into.output_tokens += add.output_tokens;
  into.cache_creation_input_tokens = (into.cache_creation_input_tokens ?? 0) + (add.cache_creation_input_tokens ?? 0);
  into.cache_read_input_tokens = (into.cache_read_input_tokens ?? 0) + (add.cache_read_input_tokens ?? 0);
  into.requests = (into.requests ?? 0) + (add.requests ?? 0);
  into.cost_usd = (into.cost_usd ?? 0) + (add.cost_usd ?? 0);
  if (add.cost_unknown) into.cost_unknown = true;
  return into;
}

// ---------- Ước tính trước khi chạy ----------

// Suy nghĩ (adaptive thinking) trước khi viết: khoảng token theo mức effort.
const THINKING: Record<Effort, [number, number]> = {
  low: [500, 2500],
  medium: [2000, 8000],
  high: [4000, 15000],
  xhigh: [8000, 25000],
  max: [12000, 40000],
};

/**
 * Ước tính token cho một MV (đã đối chiếu với kích thước yêu cầu thật: ~16–20 nghìn ký tự
 * đầu vào cho 20 cảnh). Đầu ra mỗi cảnh ~300–450 token (prompt EN + mô tả VI + audio...).
 */
export function estimateTokens(shots: number, effort: Effort, lyricsChars = 0) {
  const input = Math.round(4300 + shots * 60 + lyricsChars / 3.5);
  const [tLow, tHigh] = THINKING[effort] ?? THINKING.medium;
  return {
    input,
    outputLow: 1500 + shots * 300 + tLow,
    outputHigh: 2500 + shots * 450 + tHigh,
  };
}

export function estimateCost(price: ModelPrice | undefined, shots: number, effort: Effort, lyricsChars = 0): { low: number; high: number } | null {
  if (!price) return null;
  const t = estimateTokens(shots, effort, lyricsChars);
  return {
    low: (t.input * price.input + t.outputLow * price.output) / 1_000_000,
    high: (t.input * price.input + t.outputHigh * price.output) / 1_000_000,
  };
}

// ---------- Hiển thị ----------

export function formatUsd(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatVnd(usd: number, rate: number): string {
  const vnd = usd * rate;
  const rounded = vnd < 1000 ? Math.round(vnd / 10) * 10 : Math.round(vnd / 100) * 100;
  return `${rounded.toLocaleString("vi-VN")} đ`;
}

export function formatMoney(usd: number, rate: number): string {
  return `${formatUsd(usd)} (≈ ${formatVnd(usd, rate)})`;
}

export function formatRange(r: { low: number; high: number }, rate: number): string {
  return `${formatUsd(r.low)}–${formatUsd(r.high)} (≈ ${formatVnd(r.low, rate)}–${formatVnd(r.high, rate)})`;
}
