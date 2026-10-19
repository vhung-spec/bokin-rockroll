"use client";

// Bộ điều phối batch phía trình duyệt — một instance duy nhất, nên batch vẫn chạy khi chuyển sang trang khác
// (trong cùng tab). Tải lại trang thì batch dừng; mục đang chạy dở trở về hàng chờ để "Chạy tiếp".

import { loadBatch, saveBatch, type Batch, type BatchItem } from "./batch";
import { api } from "./client";
import type { MVResult } from "./types";

type Listener = () => void;

class BatchEngine {
  batch: Batch | null = null;
  running = false;
  concurrency = 2;
  private loaded = false;
  private controllers = new Map<string, AbortController>();
  private listeners = new Set<Listener>();
  onFinish: ((b: Batch) => void) | null = null;

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  /** Nạp batch từ localStorage (chỉ lần đầu trong phiên). */
  ensureLoaded() {
    if (this.loaded) return;
    this.loaded = true;
    this.batch = loadBatch();
  }

  replace(b: Batch | null) {
    this.stop();
    this.loaded = true;
    this.batch = b;
    saveBatch(b);
    this.emit();
  }

  private update(fn: (b: Batch) => void) {
    if (!this.batch) return;
    fn(this.batch);
    saveBatch(this.batch);
    this.emit();
  }

  private item(key: string) {
    return this.batch?.items.find((i) => i.key === key);
  }

  get inflight() {
    return this.controllers.size;
  }

  start() {
    this.running = true;
    this.emit();
    this.pump();
  }

  /** Không gửi thêm yêu cầu mới; các MV đang chạy sẽ chạy nốt. */
  pause() {
    this.running = false;
    this.emit();
  }

  /** Huỷ cả các MV đang chạy (đưa về hàng chờ). */
  stop() {
    this.running = false;
    this.controllers.forEach((c) => c.abort());
    this.emit();
  }

  setPending(predicate: (i: BatchItem) => boolean) {
    this.update((b) => b.items.forEach((i) => predicate(i) && Object.assign(i, { status: "pending", error: undefined, run: undefined })));
  }

  private pump() {
    const b = this.batch;
    if (!b || !this.running) return;
    const free = Math.max(0, this.concurrency - this.controllers.size);
    const next = b.items.filter((i) => i.status === "pending").slice(0, free);
    if (!this.controllers.size && !next.length) {
      this.running = false;
      this.emit();
      this.onFinish?.(b);
      return;
    }
    for (const it of next) void this.runItem(it.key);
  }

  private async runItem(key: string) {
    const run = Math.random().toString(36).slice(2);
    const ctrl = new AbortController();
    this.controllers.set(key, ctrl);
    this.update(() => Object.assign(this.item(key)!, { status: "running", run, error: undefined, started_at: Date.now(), finished_at: undefined }));
    const mine = () => this.item(key)?.run === run;
    try {
      const it = this.item(key)!;
      const res = await api<MVResult | { kind: "draft" }>("/api/generate", { method: "POST", json: { idea: it.idea, tone: this.batch!.tone }, signal: ctrl.signal });
      if (mine() && "kind" in res) {
        this.update(() => Object.assign(this.item(key)!, { status: "done", draft: true, finished_at: Date.now() }));
        return;
      }
      const mv = res as MVResult;
      if (mine()) {
        this.update(() =>
          Object.assign(this.item(key)!, {
            status: "done",
            mvId: mv.id,
            shots: mv.shots.length,
            errors: mv.issues.filter((i) => i.severity === "error").length,
            warnings: mv.issues.filter((i) => i.severity === "warning").length,
            cost_usd: mv.usage?.cost_usd ?? 0,
            finished_at: Date.now(),
          }),
        );
      }
    } catch (e) {
      if (mine()) {
        if (ctrl.signal.aborted) this.update(() => Object.assign(this.item(key)!, { status: "pending", started_at: undefined }));
        else this.update(() => Object.assign(this.item(key)!, { status: "error", error: (e as Error).message, finished_at: Date.now() }));
      }
    } finally {
      if (this.controllers.get(key) === ctrl) this.controllers.delete(key);
      this.pump();
    }
  }
}

export const batchEngine = new BatchEngine();
