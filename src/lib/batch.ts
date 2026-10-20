// Trạng thái batch phía trình duyệt (lưu localStorage để có thể dừng / chạy tiếp sau khi tải lại trang).

import type { IdeaRow, Tone } from "./types";

export type ItemStatus = "pending" | "running" | "done" | "error";

export interface BatchItem {
  key: string;
  idea: IdeaRow;
  status: ItemStatus;
  mvId?: string;
  error?: string;
  shots?: number;
  errors?: number;
  warnings?: number;
  started_at?: number;
  finished_at?: number;
  /** Mã lượt chạy hiện tại (bỏ qua kết quả của lượt cũ đã huỷ). */
  run?: string;
  /** Chi phí Claude API của MV này (USD). */
  cost_usd?: number;
  /** Ở chế độ claude.ai, MV được chuyển thành bản nháp chờ copy – dán. */
  draft?: boolean;
}

export interface Batch {
  id: string;
  created_at: number;
  tone: Tone;
  /** Chỉ có một bài: mở thẳng trang kết quả khi xong. */
  openWhenDone: boolean;
  items: BatchItem[];
}

const KEY = "mvps.batch.v1";

export function loadBatch(): Batch | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const b = JSON.parse(raw) as Batch;
    // Mục đang chạy dở khi đóng trang → đưa về hàng chờ.
    b.items = b.items.map((i) => (i.status === "running" ? { ...i, status: "pending" } : i));
    return b;
  } catch {
    return null;
  }
}

export function saveBatch(b: Batch | null) {
  try {
    if (b) localStorage.setItem(KEY, JSON.stringify(b));
    else localStorage.removeItem(KEY);
  } catch {
    // localStorage không khả dụng (chế độ riêng tư) — batch vẫn chạy trong phiên hiện tại.
  }
}

export function createBatch(ideas: IdeaRow[], tone: Tone = "default"): Batch {
  const now = Date.now();
  return {
    id: `b_${now.toString(36)}`,
    created_at: now,
    tone,
    openWhenDone: ideas.length === 1,
    items: ideas.map((idea, i) => ({ key: `${now.toString(36)}_${i}`, idea, status: "pending" })),
  };
}

export function unfinished(b: Batch | null): number {
  return b ? b.items.filter((i) => i.status === "pending" || i.status === "running").length : 0;
}
