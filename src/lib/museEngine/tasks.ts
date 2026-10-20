// HÀNG ĐỢI TASK của Muse trong app — lưu ở <thư mục dữ liệu Muse>/tasks.json (còn nguyên sau khi tắt app).
// Trạng thái: queued → processing → succeeded | failed | cancelled. Ảnh gửi kèm được ghi ra task-images/ để file JSON nhẹ.

import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export type TaskStatus = "queued" | "processing" | "succeeded" | "failed" | "cancelled";
export const RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4"];
/** Muse giới hạn tổng ảnh gửi kèm một lệnh 8 MB. */
export const MAX_ATTACH = 8 * 1024 * 1024;
const MAX_TASKS = 1000;

export interface GatewayTask {
  id: string;
  label: string;
  prompt: string;
  kind: "video" | "image";
  ratio: string;
  /** Đường dẫn ảnh gửi kèm (trong task-images/). */
  images: string[];
  status: TaskStatus;
  /** Bước đang làm (hiện cho người dùng). */
  step: string;
  /** Phiên chat Muse đã gửi lệnh — có rồi thì chỉ dò tiếp, không gửi lại (tránh tốn thêm lượt). */
  sessionId: string;
  attempts: number;
  /** Số lần dò lỗi liên tiếp sau khi đã gửi. */
  pollErrors: number;
  timeoutMin: number;
  createdAt: number;
  startedAt: number;
  finishedAt: number;
  /** Đường dẫn file kết quả đã tải về. */
  files: string[];
  error: string;
}

export interface NewTask {
  prompt: string;
  kind?: string;
  ratio?: string;
  label?: string;
  /** Ảnh dạng data URL (data:image/png;base64,…). */
  images?: string[];
  timeoutMin?: number;
}

/** Lỗi do dữ liệu gửi lên (trả 400). */
export class InputError extends Error {}

const IMAGE_EXT: Record<string, string> = { png: "png", jpeg: "jpg", jpg: "jpg", webp: "webp" };

export class TaskStore {
  file: string;
  imgDir: string;
  tasks: GatewayTask[];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.file = path.join(/*turbopackIgnore: true*/ dir, "tasks.json");
    this.imgDir = path.join(/*turbopackIgnore: true*/ dir, "task-images");
    try {
      this.tasks = JSON.parse(readFileSync(this.file, "utf8")) as GatewayTask[];
    } catch {
      this.tasks = [];
    }
    // Task dở khi app tắt: đã gửi lên Muse (có sessionId) → dò tiếp phiên đó; chưa gửi → xếp hàng lại.
    for (const t of this.tasks) if (t.status === "processing" && !t.sessionId) Object.assign(t, { status: "queued", step: "" });
    this.flush();
  }

  private save() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 200);
  }

  /** Ghi ngay (cả lúc tắt app). File tạm + đổi tên: tắt giữa lúc ghi không làm hỏng tasks.json. */
  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.tasks));
    renameSync(tmp, this.file);
  }

  list(status?: string): GatewayTask[] {
    return status ? this.tasks.filter((t) => t.status === status) : this.tasks;
  }

  get(id: string): GatewayTask | undefined {
    return this.tasks.find((t) => t.id === id);
  }

  add(input: NewTask): GatewayTask {
    const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
    if (!prompt) throw new InputError("Thiếu prompt.");
    if (prompt.length > 20000) throw new InputError("Prompt quá dài.");
    const id = `task_${randomBytes(8).toString("hex")}`;
    const images: { ext: string; data: Buffer }[] = [];
    for (const src of Array.isArray(input.images) ? input.images.slice(0, 10) : []) {
      const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/s.exec(String(src));
      if (!m) throw new InputError("Ảnh gửi kèm phải là data URL PNG / JPG / WEBP.");
      images.push({ ext: IMAGE_EXT[m[1]], data: Buffer.from(m[2], "base64") });
    }
    if (images.reduce((n, i) => n + i.data.length, 0) > MAX_ATTACH) throw new InputError("Ảnh gửi kèm quá 8 MB (giới hạn của Muse). Bớt ảnh hoặc dùng ảnh nhỏ hơn.");
    if (images.length) mkdirSync(this.imgDir, { recursive: true });
    const saved = images.map((img, k) => {
      const file = path.join(this.imgDir, `${id}_${k}.${img.ext}`);
      writeFileSync(file, img.data);
      return file;
    });
    const task: GatewayTask = {
      id,
      label: String(input.label ?? "").slice(0, 160),
      prompt,
      kind: input.kind === "image" ? "image" : "video",
      ratio: RATIOS.includes(String(input.ratio)) ? String(input.ratio) : "16:9",
      images: saved,
      status: "queued",
      step: "",
      sessionId: "",
      attempts: 0,
      pollErrors: 0,
      timeoutMin: Math.min(Math.max(Number(input.timeoutMin) || 0, 0), 120),
      createdAt: Date.now(),
      startedAt: 0,
      finishedAt: 0,
      files: [],
      error: "",
    };
    this.tasks.unshift(task);
    // Bỏ bớt task cũ đã kết thúc khỏi danh sách khi quá nhiều (không xoá file nào: video và ảnh vẫn nằm trong thư mục dữ liệu Muse).
    while (this.tasks.length > MAX_TASKS) {
      const i = this.tasks.findLastIndex((t) => t.status !== "queued" && t.status !== "processing");
      if (i < 0) break;
      this.tasks.splice(i, 1);
    }
    this.save();
    return task;
  }

  update(id: string, patch: Partial<GatewayTask>): GatewayTask | undefined {
    const task = this.get(id);
    if (!task) return undefined;
    Object.assign(task, patch);
    this.save();
    return task;
  }
}
