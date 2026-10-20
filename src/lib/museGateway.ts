// Gọi Cổng Muse (gateway/server.ts, mặc định http://127.0.0.1:18700) từ phía server của app — chỉ dùng phía server.
// Cổng không nhận yêu cầu từ trình duyệt, nên mọi lệnh (gửi cảnh, đăng nhập, kiểm tra) đi qua API của app.

import { UserError } from "./errors";
import type { MuseSource, MuseTask } from "./muse";

export const DEFAULT_GATEWAY_URL = "http://127.0.0.1:18700";

export interface GatewayQuota {
  pct: number;
  resetsAt: number;
  tier: string;
  label: string;
  subtitle: string;
}

export interface GatewayStatus {
  url: string;
  /** Cổng có đang chạy không. */
  reachable: boolean;
  loggedIn: boolean | null;
  loggingIn: boolean;
  quota: GatewayQuota | null;
  /** Lý do hàng đợi của cổng đang dừng ("" = không dừng). */
  paused: string;
  chromeClosed: boolean;
  counts: Record<string, number>;
  error?: string;
}

const base = (url: string) => (url || DEFAULT_GATEWAY_URL).replace(/\/+$/, "");
const notRunning = (url: string) =>
  `Chưa kết nối được Cổng Muse (${base(url)}). Mở app bằng file Chay-MV-Prompt-Studio (tự mở cổng), hoặc chạy "npm run gateway" trong thư mục app.`;

async function call<T>(url: string, method: string, p: string, body?: unknown, timeoutMs = 15000): Promise<T> {
  let res: Response;
  try {
    res = await fetch(base(url) + p, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new UserError(notRunning(url), 503);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new UserError(`Cổng Muse báo lỗi: ${data.error ?? `mã ${res.status}`}`, res.status >= 500 ? 502 : 400);
  return data as T;
}

export async function gatewayStatus(url: string): Promise<GatewayStatus> {
  try {
    const s = await call<Omit<GatewayStatus, "url" | "reachable">>(url, "GET", "/status", undefined, 5000);
    return { url: base(url), reachable: true, loggedIn: s.loggedIn, loggingIn: s.loggingIn, quota: s.quota, paused: s.paused, chromeClosed: s.chromeClosed, counts: s.counts };
  } catch (err) {
    return { url: base(url), reachable: false, loggedIn: null, loggingIn: false, quota: null, paused: "", chromeClosed: false, counts: {}, error: (err as Error).message };
  }
}

/** Hiện Chrome của cổng để người dùng đăng nhập Muse. */
export function gatewayLogin(url: string): Promise<unknown> {
  return call(url, "POST", "/login", {});
}

/** Kiểm tra lại đăng nhập + hạn mức (cổng mở Chrome nếu chưa mở). */
export function gatewayCheck(url: string): Promise<unknown> {
  return call(url, "POST", "/check", {}, 120000);
}

export interface GatewaySubmit {
  prompt: string;
  ratio: string;
  label: string;
  /** Ảnh tham chiếu dạng data URL. */
  images: string[];
}

/** Gửi một cảnh sang cổng (cổng tự xếp hàng và gửi lên Muse). Trả về id task. */
export async function gatewaySubmit(url: string, input: GatewaySubmit): Promise<string> {
  const r = await call<{ task: { id: string } }>(url, "POST", "/tasks", { ...input, kind: "video" }, 60000);
  return r.task.id;
}

/** Đọc lại phiên chat cũ của task lỗi, tải video nếu Muse đã làm xong — không gửi lại, không tốn lượt. */
export function gatewayRecheck(url: string, taskId: string): Promise<unknown> {
  return call(url, "POST", `/tasks/${encodeURIComponent(taskId)}/recheck`, {});
}

interface PublicTask {
  id: string;
  prompt: string;
  status: MuseTask["status"];
  step: string;
  error: string;
  files: string[];
  ratio: string;
  createdAt: number;
}

export function gatewaySource(url: string): MuseSource {
  return {
    async tasks() {
      const r = await call<{ tasks: PublicTask[] }>(url, "GET", "/tasks?limit=1000");
      return r.tasks.map((t) => ({ id: t.id, prompt: t.prompt, status: t.status, step: t.step, error: t.error, files: t.files, ratio: t.ratio, held: false, created_at: t.createdAt }));
    },
    // File nằm trong cổng; tải qua /tasks/:id/file.
    hasFile: () => true,
    async open(task, index) {
      const res = await fetch(`${base(url)}/tasks/${encodeURIComponent(task.id)}/file?i=${index}`).catch(() => null);
      if (!res?.ok || !res.body) return null;
      return { name: task.files[index] ?? `${task.id}.mp4`, body: res.body as ReadableStream<Uint8Array> };
    },
  };
}
