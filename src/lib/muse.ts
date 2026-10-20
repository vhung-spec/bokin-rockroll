// Tạo clip bằng Muse (Meta Muse, chạy qua tool HaoHao) — phần thuần: chữ gửi sang Muse, nhận ra task của HaoHao thuộc cảnh nào,
// trạng thái từng cảnh. Không đụng file nên dùng được cả phía server lẫn trình duyệt.

import type { Shot } from "./types";

/**
 * Một task video bên công cụ tạo video, đã chuẩn hoá.
 * Bản HaoHao cho khách: đọc từ file tasks.json của HaoHao (haohao.ts). Sau này có bản HaoHao có API thì thêm một nguồn gọi API
 * trả về cùng dạng này — phần khớp cảnh / nhận clip / tự dựng bên dưới giữ nguyên.
 */
export interface MuseTask {
  id: string;
  prompt: string;
  status: "queued" | "processing" | "succeeded" | "failed" | "cancelled";
  /** Bước đang làm (vd. "Muse đang làm", "Tải file"). */
  step: string;
  error: string;
  /** Đường dẫn các file kết quả (video trước ảnh). */
  files: string[];
  /** Tỉ lệ khung đã chọn bên HaoHao ("16:9", "9:16"…; "" = không chọn). */
  ratio: string;
  /** Task mới chỉ được thêm vào hàng đợi, chờ bấm Chạy trong HaoHao. */
  held: boolean;
  /** Lúc tạo task (ms). */
  created_at: number;
}

/** Nguồn task của công cụ tạo video (xem MuseTask). */
export interface MuseSource {
  tasks(): Promise<MuseTask[]>;
}

/**
 * Trạng thái một cảnh: waiting = đã copy prompt, chưa thấy bên HaoHao · queued = HaoHao đã nhận, đang xếp hàng ·
 * running = Muse đang làm · done = clip đã vào MV · error = Muse / HaoHao báo lỗi · kept = cảnh đã có clip bạn tự thêm, không đè.
 */
export type MuseShotStatus = "waiting" | "queued" | "running" | "done" | "error" | "kept";

export interface MuseShotJob {
  shot_no: number;
  /** Chữ đã gửi sang Muse — dùng để nhận ra task của cảnh này bên HaoHao. */
  text: string;
  sent_at: string;
  status: MuseShotStatus;
  task_id?: string;
  step?: string;
  message?: string;
  /** Clip của cảnh lúc gửi (được thay bằng clip Muse); null = cảnh chưa có clip. */
  replaces?: string | null;
  /** File clip Muse đã đưa vào MV (trong data/media/<mvId>/). */
  clip_file?: string;
  /** Task đã xong nhưng đưa clip vào MV bị lỗi — không thử lại liên tục (chạy lại task trong HaoHao hoặc gửi lại cảnh). */
  import_error_task?: string;
  done_at?: string;
}

export interface MuseMV {
  mv_id: string;
  title: string;
  added_at: string;
  shots: MuseShotJob[];
  /** Lúc app tự thêm MV vào hàng chờ dựng (đủ clip + có nhạc). */
  queued_at?: string;
  note?: string;
}

export interface MuseState {
  mvs: MuseMV[];
}

export const MUSE_STATUS_LABEL: Record<MuseShotStatus, string> = {
  waiting: "Chờ dán vào HaoHao",
  queued: "HaoHao đã nhận",
  running: "Muse đang làm",
  done: "Đã vào MV",
  error: "Lỗi",
  kept: "Giữ clip của bạn",
};

/** Trạng thái đã xong, không theo dõi nữa. */
export const isFinal = (s: MuseShotStatus) => s === "done" || s === "kept";

/** Gom về một dòng (HaoHao tách prompt bằng dòng trống nên mỗi prompt không được có dòng trống bên trong). */
export const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** Khoá so khớp: HaoHao chuẩn hoá NFC trước khi gửi; khoảng trắng có thể khác. */
export const matchKey = (s: string) => oneLine(s.normalize("NFC"));

/**
 * Chữ gửi sang Muse cho một cảnh: prompt hoàn chỉnh, và nếu `avoid` thì thêm "Avoid: …" từ negative prompt
 * (Muse không có ô negative prompt riêng). HaoHao tự thêm dòng "Tạo video · tỷ lệ 16:9 ngang" phía trước.
 */
export function museText(shot: Pick<Shot, "prompt_en" | "negative_prompt">, opts: { avoid: boolean }): string {
  const prompt = oneLine(shot.prompt_en);
  const negative = oneLine(shot.negative_prompt ?? "").replace(/[.,;\s]+$/, "");
  return opts.avoid && negative ? `${prompt} Avoid: ${negative}.` : prompt;
}

/** Nội dung để dán vào tab Studio của HaoHao: mỗi prompt một video, cách nhau một dòng trống. */
export function pasteText(texts: string[]): string {
  return texts.length ? texts.join("\n\n") + "\n" : "";
}

const STATUSES = new Set(["queued", "processing", "succeeded", "failed", "cancelled"]);

/** Đọc mảng task trong tasks.json của HaoHao → MuseTask (chỉ task video; bỏ qua mục hỏng). */
export function parseHaoHaoTasks(raw: unknown): MuseTask[] {
  if (!Array.isArray(raw)) throw new Error("tasks.json của HaoHao không đúng dạng (không phải danh sách task).");
  const out: MuseTask[] = [];
  for (const t of raw as Record<string, unknown>[]) {
    if (!t || typeof t.id !== "string" || typeof t.prompt !== "string" || !STATUSES.has(String(t.status))) continue;
    if (t.kind !== undefined && t.kind !== "video") continue;
    out.push({
      id: t.id,
      prompt: t.prompt,
      status: t.status as MuseTask["status"],
      step: typeof t.step === "string" ? t.step : "",
      error: typeof t.error === "string" ? t.error : "",
      files: Array.isArray(t.files) ? t.files.filter((f): f is string => typeof f === "string") : [],
      ratio: typeof t.ratio === "string" ? t.ratio : "",
      held: t.held === true,
      created_at: Number(t.createdAt) || 0,
    });
  }
  return out;
}

/**
 * Task của HaoHao ứng với cảnh: cùng nội dung, tạo sau lúc copy prompt (HaoHao và app chạy trên cùng một máy, cùng đồng hồ;
 * task cũ hơn — vd. task lỗi trước khi gửi lại cảnh — không tính).
 * Ưu tiên task đã xong (mới nhất), rồi task đang chờ / đang làm, cuối cùng mới tới task lỗi / huỷ.
 * (Dán hai lần thì lấy cái xong trước; "Thử lại" trong HaoHao giữ nguyên id task nên vẫn theo được.)
 */
export function pickTask(job: Pick<MuseShotJob, "text" | "sent_at">, tasks: MuseTask[]): MuseTask | undefined {
  const key = matchKey(job.text);
  const since = Date.parse(job.sent_at);
  const mine = tasks.filter((t) => t.created_at >= since && matchKey(t.prompt) === key).sort((a, b) => b.created_at - a.created_at);
  return (
    mine.find((t) => t.status === "succeeded") ??
    mine.find((t) => t.status === "queued" || t.status === "processing") ??
    mine.find((t) => t.status === "failed" || t.status === "cancelled")
  );
}

/** Task đã xong sẵn bên HaoHao với đúng nội dung này (để nhận luôn, không tốn thêm lượt Muse). */
export function finishedTask(text: string, tasks: MuseTask[], fileExists: (f: string) => boolean): MuseTask | undefined {
  const key = matchKey(text);
  return tasks
    .filter((t) => t.status === "succeeded" && matchKey(t.prompt) === key && t.files.some(fileExists))
    .sort((a, b) => b.created_at - a.created_at)[0];
}

/** Nhắc khi bên HaoHao không chọn khung 16:9. */
const RATIO_NOTE = (ratio: string) => (ratio && ratio !== "16:9" ? `HaoHao đang để tỉ lệ ${ratio} (MV dùng 16:9).` : undefined);

/**
 * Cảnh đang theo dõi + task tương ứng → trạng thái mới. `importNow` = task đã xong, cần đưa clip vào MV.
 * Cảnh đã xong (done / kept) không đổi nữa.
 */
export function advanceJob(job: MuseShotJob, task: MuseTask | undefined): { job: MuseShotJob; importNow?: MuseTask } {
  if (isFinal(job.status)) return { job };
  if (!task) {
    // Task đã từng thấy nay biến mất (bị xoá bên HaoHao) → quay về chờ.
    const lost = job.task_id && job.status !== "waiting";
    return {
      job: {
        ...job,
        status: "waiting",
        task_id: undefined,
        step: undefined,
        message: lost ? "Task bên HaoHao đã bị xoá — dán lại prompt nếu vẫn cần cảnh này." : job.status === "waiting" ? job.message : undefined,
      },
    };
  }
  if (task.status === "succeeded" && job.import_error_task === task.id) return { job };
  const base = { ...job, task_id: task.id, import_error_task: undefined };
  switch (task.status) {
    case "queued":
      return { job: { ...base, status: "queued", step: task.held ? "Chờ bấm Chạy trong HaoHao" : "Đang xếp hàng", message: RATIO_NOTE(task.ratio) } };
    case "processing":
      return { job: { ...base, status: "running", step: task.step || "Muse đang làm", message: RATIO_NOTE(task.ratio) } };
    case "failed":
    case "cancelled":
      return {
        job: { ...base, status: "error", step: undefined, message: task.error || (task.status === "cancelled" ? "Đã huỷ bên HaoHao." : "Muse báo lỗi.") },
      };
    case "succeeded":
      return { job: { ...base, status: "running", step: "Đang đưa clip vào MV", message: RATIO_NOTE(task.ratio) }, importNow: task };
  }
}

export interface MuseCounts {
  total: number;
  done: number;
  active: number;
  waiting: number;
  error: number;
}

export function museCounts(mv: Pick<MuseMV, "shots">): MuseCounts {
  const c = { total: mv.shots.length, done: 0, active: 0, waiting: 0, error: 0 };
  for (const s of mv.shots) {
    if (isFinal(s.status)) c.done++;
    else if (s.status === "error") c.error++;
    else if (s.status === "waiting") c.waiting++;
    else c.active++;
  }
  return c;
}

/** Số cảnh còn đang chờ / đang làm / lỗi (để hiện trên thanh menu). */
export const museOpen = (state: MuseState) => state.mvs.reduce((n, mv) => n + mv.shots.filter((s) => !isFinal(s.status)).length, 0);
