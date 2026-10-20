// MUSE TRONG APP — Chrome + hàng đợi + Worker chạy ngay trong server của app (trước đây là Cổng Muse riêng ở 127.0.0.1:18700).
// Một bản duy nhất cho cả tiến trình (giữ qua hot reload khi phát triển). Chỉ dùng phía server.
// Tắt app → Chrome của Muse tự tắt theo; mở lại app → task đang làm dở được dò tiếp (không gửi lại).

import path from "node:path";
import { Chrome } from "./chrome";
import { FakeMuse } from "./fake";
import { MusePage, type MuseDriver } from "./page";
import { Worker, type WorkerOptions, type WorkerState } from "./runner";
import { TaskStore, type GatewayTask } from "./tasks";

export interface MuseEngine {
  dir: string;
  store: TaskStore;
  worker: Worker;
  page: MuseDriver;
  fake: boolean;
}

/**
 * Thư mục dữ liệu (profile Chrome có phiên đăng nhập Muse, hàng đợi, video tải về): NGOÀI thư mục app, ngay bên cạnh, cùng ổ đĩa
 * (vd. D:\bokin-rockroll-muse-gateway). Lúc build, Next.js đọc file trong thư mục app và sẽ vấp vào profile Chrome đang mở.
 */
export function museDataDir(): string {
  if (process.env.MUSE_ENGINE_DIR) return path.resolve(/*turbopackIgnore: true*/ process.env.MUSE_ENGINE_DIR);
  const root = path.resolve(/*turbopackIgnore: true*/ process.cwd());
  return path.join(/*turbopackIgnore: true*/ path.dirname(root), `${path.basename(root)}-muse-gateway`);
}

const g = globalThis as unknown as { __mvMuseEngine?: MuseEngine };

/** Tạo (lại) bộ máy Muse. Test truyền Muse giả + thư mục tạm; MUSE_FAKE=1 dùng Muse giả để xem thử (không mở Chrome, không tốn lượt). */
export function initMuseEngine(opts: { dir?: string; page?: MuseDriver; worker?: Partial<Omit<WorkerOptions, "store" | "page" | "outputDir">> } = {}): MuseEngine {
  const dir = opts.dir ?? museDataDir();
  const fake = !opts.page && Boolean(process.env.MUSE_FAKE);
  const page = opts.page ?? (fake ? new FakeMuse() : new MusePage(new Chrome({ profileDir: path.join(/*turbopackIgnore: true*/ dir, "chrome-profile"), url: "https://muse.ai" })));
  const store = new TaskStore(dir);
  const worker = new Worker({ store, page, outputDir: path.join(/*turbopackIgnore: true*/ dir, "videos"), ...(fake ? { gapMs: 1000, pollMs: 1000 } : {}), ...opts.worker });
  g.__mvMuseEngine = { dir, store, worker, page, fake };
  // Có task dở từ lần chạy trước → chạy tiếp.
  if (store.list().some((t) => t.status === "queued" || t.status === "processing")) worker.pump();
  return g.__mvMuseEngine;
}

export function museEngine(): MuseEngine {
  return g.__mvMuseEngine ?? initMuseEngine();
}

/** Tắt bộ máy (đóng Chrome, ghi hàng đợi) — dùng khi test. */
export async function closeMuseEngine(): Promise<void> {
  const e = g.__mvMuseEngine;
  g.__mvMuseEngine = undefined;
  await e?.worker.close();
}

export interface EngineStatus extends WorkerState {
  /** Đang chạy Muse giả (MUSE_FAKE=1). */
  fake: boolean;
  dir: string;
  counts: Record<GatewayTask["status"], number>;
}

export function engineStatus(e: MuseEngine = museEngine()): EngineStatus {
  const counts = { queued: 0, processing: 0, succeeded: 0, failed: 0, cancelled: 0 };
  for (const t of e.store.list()) counts[t.status]++;
  return { ...e.worker.state, fake: e.fake, dir: e.dir, counts };
}
