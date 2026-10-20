// Hàng chờ dựng video: chọn thiết lập một lần (thiết lập chung), thêm nhiều MV, app dựng lần lượt từng MV.
// Lưu trong data/render_queue.json; mỗi lúc chỉ dựng một MV để máy không quá tải.

import { UserError } from "./errors";
import { cancelRender, getJob, startRender, waitRender } from "./render";
import { QUEUE_FILE, readJson, withLock, writeJson } from "./store";
import type { RenderJob } from "./types";

export type QueueStatus = "waiting" | "running" | "done" | "error" | "skipped" | "cancelled";

export interface QueueItem {
  id: string;
  mv_id: string;
  added_at: string;
  status: QueueStatus;
  /** Lý do bỏ qua / lỗi. */
  message?: string;
  /** File video đã dựng (trong data/media/<mv_id>/). */
  output?: string;
  started_at?: string;
  finished_at?: string;
}

export interface QueueState {
  /** Đang chạy (tự lấy MV kế tiếp khi xong MV hiện tại). */
  running: boolean;
  items: QueueItem[];
}

// Trạng thái trong tiến trình: vòng chạy hiện tại, và đã dọn các mục "running" còn sót từ lần mở app trước chưa.
const g = globalThis as unknown as { __mvQueue?: { loop: Promise<void> | null; recovered: boolean } };
const mem = (g.__mvQueue ??= { loop: null, recovered: false });

async function load(): Promise<QueueState> {
  const q = await readJson<QueueState>(QUEUE_FILE(), { running: false, items: [] });
  if (!mem.recovered) {
    // App vừa mở lại: mục đang dựng dở quay về hàng chờ, hàng chờ ở trạng thái dừng cho tới khi bấm Chạy.
    mem.recovered = true;
    q.running = false;
    for (const it of q.items) if (it.status === "running") Object.assign(it, { status: "waiting", message: "Dựng dở khi app tắt — sẽ dựng lại." });
  }
  return q;
}

function update<T>(fn: (q: QueueState) => T | Promise<T>): Promise<T> {
  return withLock("render-queue", async () => {
    const q = await load();
    const result = await fn(q);
    await writeJson(QUEUE_FILE(), q);
    return result;
  });
}

export async function readQueue(): Promise<QueueState & { job: RenderJob | null }> {
  const q = await withLock("render-queue", load);
  const current = q.items.find((i) => i.status === "running");
  return { ...q, job: current ? getJob(current.mv_id) : null };
}

const newId = () => `q_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Thêm MV vào cuối hàng chờ (MV đang chờ / đang dựng thì bỏ qua). Trả về số MV đã thêm. */
export function addToQueue(mvIds: string[]): Promise<number> {
  return update((q) => {
    let added = 0;
    for (const mv_id of mvIds) {
      if (q.items.some((i) => i.mv_id === mv_id && (i.status === "waiting" || i.status === "running"))) continue;
      q.items.push({ id: newId(), mv_id, added_at: new Date().toISOString(), status: "waiting" });
      added++;
    }
    return added;
  });
}

export function removeFromQueue(itemId: string): Promise<void> {
  return update((q) => {
    const it = q.items.find((i) => i.id === itemId);
    if (it?.status === "running") throw new UserError("MV này đang dựng — huỷ trước rồi mới xoá khỏi hàng chờ.", 409);
    q.items = q.items.filter((i) => i.id !== itemId);
  });
}

/** Đưa một mục đã xong / lỗi / bỏ qua về lại hàng chờ. */
export function retryItem(itemId: string): Promise<void> {
  return update((q) => {
    const it = q.items.find((i) => i.id === itemId);
    if (it && it.status !== "running" && it.status !== "waiting") {
      Object.assign(it, { status: "waiting", message: undefined, output: undefined, started_at: undefined, finished_at: undefined });
    }
  });
}

export function clearFinished(): Promise<void> {
  return update((q) => {
    q.items = q.items.filter((i) => i.status === "waiting" || i.status === "running");
  });
}

/** Bắt đầu (hoặc tiếp tục) dựng lần lượt các MV đang chờ. */
export function startQueue(): Promise<void> {
  // Bật cờ và khởi động vòng chạy trong cùng một khoá với lúc vòng chạy quyết định dừng: không bao giờ kẹt.
  return update((q) => {
    q.running = true;
    if (!mem.loop) mem.loop = runLoop();
  });
}

/** Dừng sau khi dựng xong MV hiện tại. */
export function pauseQueue(): Promise<void> {
  return update((q) => {
    q.running = false;
  });
}

/** Huỷ MV đang dựng và dừng hàng chờ. */
export async function cancelCurrent(): Promise<void> {
  const current = await update((q) => {
    q.running = false;
    return q.items.find((i) => i.status === "running");
  });
  if (current) cancelRender(current.mv_id);
}

/** Chờ vòng chạy hiện tại kết thúc (dùng cho test). */
export async function idle(): Promise<void> {
  await mem.loop;
}

async function runLoop(): Promise<void> {
  for (;;) {
    const item = await update((q) => {
      const next = q.running ? q.items.find((i) => i.status === "waiting") : undefined;
      if (!next) {
        q.running = false;
        mem.loop = null;
        return null;
      }
      Object.assign(next, { status: "running", message: undefined, started_at: new Date().toISOString() });
      return { ...next };
    });
    if (!item) return;

    let result: Partial<QueueItem>;
    try {
      await startRender(item.mv_id);
      const job = await waitRender(item.mv_id);
      result =
        job?.status === "done"
          ? { status: "done", output: job.output?.file }
          : job?.status === "cancelled"
            ? { status: "cancelled", message: "Đã huỷ." }
            : { status: "error", message: job?.error ?? "Dựng thất bại." };
    } catch (err) {
      // Thiếu bài hát / clip, MV đã bị xoá… → bỏ qua và dựng MV kế tiếp.
      result = { status: err instanceof UserError || /Không tìm thấy MV/.test((err as Error).message) ? "skipped" : "error", message: (err as Error).message };
    }
    await update((q) => {
      const it = q.items.find((i) => i.id === item.id);
      if (it) Object.assign(it, result, { finished_at: new Date().toISOString() });
    });
  }
}
