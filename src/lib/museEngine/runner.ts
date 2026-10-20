// CHẠY TASK — gửi lệnh lên Muse, dò tới khi xong, tải file về; Worker chạy lần lượt từng task trên MỘT tài khoản Muse.
// Chuyển từ engine/muse-runner.js + pool.js của HaoHao (bỏ nhiều tài khoản, proxy, chat storyboard).
// Không tự gửi lại khi Muse đã nhận lệnh: lỗi mạng lúc dò thì dò lại đúng phiên đó (không tốn thêm lượt).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { weeklyOut, type Attachment, type MuseDriver, type Quota } from "./page";
import { InputError, MAX_ATTACH, type GatewayTask, type TaskStore } from "./tasks";

const RATIO_LABEL: Record<string, string> = { "9:16": "9:16 dọc", "16:9": "16:9 ngang", "1:1": "1:1 vuông", "4:3": "4:3 ngang", "3:4": "3:4 dọc" };
const EXT: Record<string, string> = { "video/mp4": "mp4", "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg" };
const MIME: Record<string, string> = { ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };
/** Dò lỗi liên tiếp quá chừng này thì coi là mất kết nối (task giữ phiên, dò lại sau). */
const MAX_POLL_ERRORS = 5;
/** Sau khi gửi, phiên có thể chưa kịp hiện trong danh sách của Muse — chờ tối đa chừng này. */
const START_GRACE_MS = 30e3;

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Lỗi do Muse trả lời (không ra file / quá giờ) — khác lỗi đường truyền: chỉ gửi lại bằng chat mới mới có ích. */
export class MuseResultError extends Error {}

/** Lệnh gửi vào chat Muse: dòng yêu cầu + tỉ lệ khung, rồi tới prompt. */
export function buildMessage(task: Pick<GatewayTask, "kind" | "ratio" | "prompt">): string {
  const head = (task.kind === "image" ? "Tạo ảnh" : "Tạo video") + (RATIO_LABEL[task.ratio] ? ` · tỷ lệ ${RATIO_LABEL[task.ratio]}` : "");
  return `${head}\n${task.prompt}`;
}

function attachments(task: GatewayTask): Attachment[] {
  const atts = task.images.map((file, k): Attachment => {
    const mimeType = MIME[path.extname(file).toLowerCase()] ?? "image/jpeg";
    return { filename: `anh_${k + 1}.${EXT[mimeType] ?? "jpg"}`, mimeType, dataBase64: readFileSync(file).toString("base64"), category: "image" };
  });
  if (atts.reduce((n, a) => n + Buffer.byteLength(a.dataBase64, "base64"), 0) > MAX_ATTACH) throw new MuseResultError("Ảnh gửi kèm quá 8 MB (giới hạn của Muse).");
  return atts;
}

export interface RunOptions {
  page: MuseDriver;
  update: (patch: Partial<GatewayTask>) => void;
  /** Task còn đang chạy (chưa bị huỷ)? */
  isLive: () => boolean;
  outputDir: string;
  limits?: { image: number; video: number };
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  pollMs?: number;
}

/** Chạy một task. Trả đường dẫn các file đã tải; null nếu task bị huỷ giữa chừng; ném lỗi khi hỏng. */
export async function runTask(task: GatewayTask, o: RunOptions): Promise<string[] | null> {
  const { page, update, isLive, outputDir, limits = { image: 5, video: 30 }, sleep = realSleep, now = Date.now, pollMs = 4000 } = o;
  const what = task.kind === "image" ? "ảnh" : "video";
  let sid = task.sessionId;
  const sentAt = now();

  if (!sid) {
    const atts = attachments(task);
    update({ step: "Gửi lệnh" });
    const sent = await page.send(buildMessage(task), atts);
    if (!sent?.ok || !sent.sessionId) throw new Error(`Muse không nhận lệnh: ${sent?.reason || "không rõ lý do"}`);
    sid = sent.sessionId;
    update({ sessionId: sid, step: "Muse đang làm" });
  }

  // Tính giờ từ lúc task bắt đầu → tắt mở lại app vẫn giữ đúng hạn.
  const limitMin = Math.max(task.kind === "image" ? limits.image : limits.video, task.timeoutMin || 0);
  let status: string | null = null;
  for (let errors = 0; ; ) {
    await sleep(pollMs);
    if (!isLive()) return null;
    try {
      status = await page.status(sid);
      errors = 0;
    } catch (e) {
      if (++errors >= MAX_POLL_ERRORS) throw e;
      status = "running";
    }
    if (status === null && now() - sentAt < START_GRACE_MS) continue;
    if (status !== "running") break;
    if (now() - task.startedAt > limitMin * 60e3) {
      await page.cancel(sid).catch(() => {});
      throw new MuseResultError(`Quá ${limitMin} phút Muse chưa làm xong.`);
    }
  }
  if (!isLive()) return null;

  const { files, text } = await page.result(sid);
  let wanted = files.filter((f) => f.mime.startsWith(task.kind === "image" ? "image/" : "video/"));
  if (task.kind === "image") wanted = wanted.slice(0, 1);
  if (!wanted.length) {
    throw new MuseResultError(text ? `Muse không tạo ${what}. Muse trả lời: "${text}"` : `Muse không trả về ${what} (phiên ${status || "không thấy"}).`);
  }

  update({ step: "Tải file" });
  mkdirSync(outputDir, { recursive: true });
  const saved: string[] = [];
  for (const [k, f] of wanted.entries()) {
    const buf = await page.readFile(f.path);
    if (f.byteLen > 0 && buf.length !== f.byteLen) throw new Error(`Tải file lỗi: ${buf.length}/${f.byteLen} byte`);
    const file = path.join(/*turbopackIgnore: true*/ outputDir, `${task.id}_${k + 1}.${EXT[f.mime] ?? f.mime.split("/")[1]}`);
    writeFileSync(file, buf);
    saved.push(file);
  }
  return saved;
}

/**
 * Sau lỗi → phần cập nhật của task. Đã gửi mà lỗi đường truyền → giữ phiên, dò lại (tối đa 3 lần; không gửi lại, không tốn lượt).
 * Còn lại: hết số lần thử → failed; chưa hết → xếp hàng gửi lại bằng chat mới. Mặc định chỉ thử 1 lần (mỗi lần gửi = 1 lượt Muse).
 */
export function failurePatch(task: GatewayTask, e: Error, now = Date.now(), maxAttempts = 1): Partial<GatewayTask> {
  if (task.sessionId && !(e instanceof MuseResultError) && task.pollErrors < 3) {
    return { pollErrors: task.pollErrors + 1, step: `Mất kết nối khi dò — dò lại phiên cũ (${e.message})` };
  }
  if (task.attempts >= maxAttempts) return { status: "failed", step: "", error: e.message, finishedAt: now };
  return { status: "queued", step: "", sessionId: "", pollErrors: 0, error: `Lỗi lần ${task.attempts}, gửi lại: ${e.message}` };
}

export interface WorkerOptions {
  store: TaskStore;
  page: MuseDriver;
  outputDir: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Nghỉ tối thiểu giữa hai lần gửi lệnh (không gửi dồn dập). */
  gapMs?: number;
  pollMs?: number;
  /** Chờ đăng nhập: dò mỗi chừng này, tối đa loginWaitMs. */
  loginPollMs?: number;
  loginWaitMs?: number;
  limits?: { image: number; video: number };
  maxAttempts?: number;
}

export interface WorkerState {
  /** null = chưa biết (chưa mở Chrome). */
  loggedIn: boolean | null;
  loggingIn: boolean;
  quota: Quota | null;
  /** Lý do hàng đợi đang dừng ("" = không dừng). */
  paused: string;
  /** Người dùng đã tự đóng cửa sổ Chrome của Muse. */
  chromeClosed: boolean;
  current: string | null;
  lastSentAt: number;
  /** Muse báo hết hạn mức (qua lời từ chối / câu trả lời) — lúc nào, Muse nói gì. Hàng đợi dừng tới khi bấm Kiểm tra hoặc sau 6 giờ. */
  limitHit: { at: number; message: string } | null;
}

/**
 * Muse không còn cho đọc % hạn mức (trang đổi, 20/10/2026) → nhận ra "hết hạn mức" qua lời Muse nói khi từ chối lệnh / trả lời.
 * Chặt để không nhầm câu trả lời bình thường.
 */
export const LIMIT_RE =
  /(usage|weekly|rate|daily|monthly)\s+limit|limit (reached|exceeded)|quota|out of (credits|tokens)|hết (hạn mức|lượt|token)|đã dùng hết|vượt (quá )?giới hạn|giới hạn (sử dụng|hàng tuần|hằng tuần)|nâng cấp gói|upgrade (your|to) /i;
const LIMIT_PAUSE_MS = 6 * 3600e3;

/** Chạy lần lượt các task trên một tài khoản Muse. */
export class Worker {
  state: WorkerState = { loggedIn: null, loggingIn: false, quota: null, paused: "", chromeClosed: false, current: null, lastSentAt: 0, limitHit: null };
  private o: Required<Omit<WorkerOptions, "store" | "page" | "outputDir">> & Pick<WorkerOptions, "store" | "page" | "outputDir">;
  private loop: Promise<void> | null = null;
  private again = false;
  private wakeTimer: ReturnType<typeof setTimeout> | null = null;
  private loginJob: Promise<boolean> | null = null;

  constructor(opts: WorkerOptions) {
    this.o = {
      sleep: realSleep,
      now: Date.now,
      gapMs: 15e3,
      pollMs: 4000,
      loginPollMs: 5000,
      loginWaitMs: 15 * 60e3,
      limits: { image: 5, video: 30 },
      maxAttempts: 1,
      ...opts,
    };
    opts.page.onUserClose(() => {
      this.state.chromeClosed = true;
      this.state.loggedIn = null;
    });
  }

  /** Chạy hàng đợi (nếu chưa chạy). Gọi khi có task mới, đăng nhập xong, tới giờ đặt lại hạn mức… */
  pump(): void {
    if (this.loop) {
      this.again = true;
      return;
    }
    this.loop = this.run()
      .catch((e) => {
        this.state.paused = `Lỗi: ${(e as Error).message}`;
      })
      .finally(() => {
        this.loop = null;
      });
  }

  /** Chờ vòng chạy hiện tại xong (dùng cho test / lúc tắt app). */
  async idle(): Promise<void> {
    while (this.loop) await this.loop;
  }

  private next(): GatewayTask | undefined {
    const tasks = this.o.store.list();
    const oldest = (list: GatewayTask[]) => list.sort((a, b) => a.createdAt - b.createdAt)[0];
    return oldest(tasks.filter((t) => t.status === "processing" && t.sessionId)) ?? oldest(tasks.filter((t) => t.status === "queued"));
  }

  private async run(): Promise<void> {
    for (;;) {
      this.again = false;
      const task = this.next();
      if (!task) {
        this.state.paused = "";
        if (this.again) continue;
        return;
      }
      const blocked = await this.ready(task);
      if (blocked) {
        // Chờ đăng nhập / chờ đặt lại hạn mức: login() hoặc hẹn giờ sẽ chạy lại hàng đợi.
        this.state.paused = blocked;
        return;
      }
      this.state.paused = "";
      await this.runOne(task);
    }
  }

  /** "" nếu gửi / dò được; không thì lý do phải chờ. */
  private async ready(task: GatewayTask): Promise<string> {
    const closed = "Cửa sổ Chrome của Muse đã bị đóng — bấm “Đăng nhập Muse” để mở lại.";
    if (this.state.chromeClosed) return closed;
    let ok = false;
    // Trang vừa mở còn đang tải → login() báo chưa; thử vài lần trước khi kết luận.
    for (let i = 0; i < 10 && !ok; i++) {
      try {
        ok = (await this.o.page.login()).loggedIn;
      } catch (e) {
        if (i === 9) return `Không mở được Muse: ${(e as Error).message}`;
      }
      if (this.state.chromeClosed) return closed;
      if (!ok && i < 9) await this.o.sleep(3000);
    }
    this.state.loggedIn = ok;
    if (!ok) return "Chưa đăng nhập Muse — bấm “Đăng nhập Muse” rồi đăng nhập trong cửa sổ Chrome vừa mở.";
    if (task.status !== "queued") return ""; // dò tiếp phiên đã gửi không tốn lượt
    const now = this.o.now();
    const hit = this.state.limitHit;
    if (hit && now - hit.at < LIMIT_PAUSE_MS) {
      this.wakeAt(hit.at + LIMIT_PAUSE_MS);
      return `Muse báo hết hạn mức (“${hit.message.slice(0, 160)}”) — tạm dừng gửi. Bấm “Kiểm tra” để chạy tiếp, hoặc app tự thử lại lúc ${new Date(hit.at + LIMIT_PAUSE_MS).toLocaleString("vi-VN")}.`;
    }
    if (!this.state.quota || now - this.state.quota.checkedAt > 10 * 60e3) await this.refreshQuota();
    const q = this.state.quota;
    if (q && weeklyOut(q) && (!q.resetsAt || q.resetsAt > now)) {
      if (q.resetsAt) this.wakeAt(q.resetsAt);
      return `Hết hạn mức tuần của Muse${q.resetsAt ? ` — đặt lại ${new Date(q.resetsAt).toLocaleString("vi-VN")}` : ""}.`;
    }
    return "";
  }

  private async runOne(task: GatewayTask): Promise<void> {
    const { store, now } = this.o;
    const id = task.id;
    const isLive = () => store.get(id)?.status === "processing";
    this.state.current = id;
    try {
      if (task.status === "queued") {
        const wait = this.state.lastSentAt + this.o.gapMs - now();
        if (wait > 0) {
          store.update(id, { step: `Nghỉ ${Math.ceil(wait / 1000)} giây rồi mới gửi (không gửi dồn)` });
          await this.o.sleep(wait);
          if (store.get(id)?.status !== "queued") return; // bị huỷ trong lúc chờ
        }
        store.update(id, { status: "processing", step: "Gửi lệnh", startedAt: now(), finishedAt: 0, attempts: task.attempts + 1, error: "", files: [], sessionId: "", pollErrors: 0 });
      }
      const files = await runTask(store.get(id)!, {
        page: this.o.page,
        update: (p) => {
          if (p.sessionId) this.state.lastSentAt = now();
          store.update(id, p);
        },
        isLive,
        outputDir: this.o.outputDir,
        limits: this.o.limits,
        sleep: this.o.sleep,
        now,
        pollMs: this.o.pollMs,
      });
      if (!files || !isLive()) return;
      store.update(id, { status: "succeeded", step: `Đã tải ${files.length} file`, finishedAt: now(), files, pollErrors: 0 });
      void this.refreshQuota();
    } catch (err) {
      if (!isLive()) return;
      const e = err as Error;
      // Muse không nhận lệnh: có thể do hết hạn mức → trả task về hàng đợi, không tính lượt.
      if (/^Muse không nhận lệnh/.test(e.message)) {
        await this.refreshQuota();
        if (weeklyOut(this.state.quota)) {
          const t = store.get(id)!;
          store.update(id, { status: "queued", step: "", sessionId: "", attempts: t.attempts - 1, error: "Hết hạn mức tuần — chờ đặt lại." });
          return;
        }
      }
      // Muse nói đã hết hạn mức (lúc từ chối hoặc trong câu trả lời) → dừng hàng đợi, task chờ gửi lại sau.
      if (LIMIT_RE.test(e.message)) {
        this.state.limitHit = { at: now(), message: e.message.replace(/^Muse (không nhận lệnh|không tạo video)[.:]?\s*/, "") };
        const t = store.get(id)!;
        store.update(id, { status: "queued", step: "", sessionId: "", attempts: Math.max(0, t.attempts - 1), error: "Muse báo hết hạn mức — chờ chạy tiếp." });
        return;
      }
      store.update(id, failurePatch(store.get(id)!, e, now(), this.o.maxAttempts));
    } finally {
      this.state.current = null;
    }
  }

  async refreshQuota(): Promise<Quota | null> {
    try {
      const q = await this.o.page.quota();
      if (q) this.state.quota = q;
    } catch {
      // không đọc được hạn mức → giữ số cũ
    }
    return this.state.quota;
  }

  private wakeAt(at: number) {
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    this.wakeTimer = setTimeout(() => this.pump(), Math.min(Math.max(at - this.o.now(), 1000), 3600e3));
    this.wakeTimer.unref?.();
  }

  /**
   * Đăng nhập: chưa đăng nhập thì hiện Chrome của Muse, dò mỗi vài giây tới khi xong (tối đa 15 phút) rồi cất cửa sổ đi.
   * Người dùng đóng cửa sổ Chrome = bỏ đăng nhập.
   */
  login(): Promise<boolean> {
    if (this.loginJob) {
      void this.o.page.show().catch(() => {});
      return this.loginJob;
    }
    const { page, sleep, now } = this.o;
    this.state.chromeClosed = false;
    this.state.loggingIn = true;
    const done = async (ok: boolean) => {
      this.state.loggedIn = ok;
      if (ok) {
        await page.hide().catch(() => {});
        await this.refreshQuota();
        this.pump();
      }
      return ok;
    };
    this.loginJob = (async () => {
      try {
        if ((await page.login().catch(() => null))?.loggedIn) return await done(true);
        await page.show();
        const until = now() + this.o.loginWaitMs;
        while (now() < until && !this.state.chromeClosed) {
          await sleep(this.o.loginPollMs);
          if ((await page.login().catch(() => null))?.loggedIn) return await done(true);
        }
        return await done(false);
      } catch (e) {
        this.state.paused = `Không mở được Chrome: ${(e as Error).message}`;
        return false;
      } finally {
        this.state.loggingIn = false;
        this.loginJob = null;
      }
    })();
    return this.loginJob;
  }

  /** Kiểm tra lại đăng nhập + hạn mức (mở Chrome nếu chưa mở). */
  async check(): Promise<WorkerState> {
    // Người dùng bấm Kiểm tra = cho chạy tiếp sau khi Muse báo hết hạn mức.
    this.state.limitHit = null;
    if (!this.state.chromeClosed) {
      try {
        // Trang vừa mở còn đang tải → login() báo chưa; thử vài lần trước khi kết luận.
        for (let i = 0; i < 6; i++) {
          this.state.loggedIn = (await this.o.page.login()).loggedIn;
          if (this.state.loggedIn) break;
          await this.o.sleep(3000);
        }
        if (this.state.loggedIn) await this.refreshQuota();
      } catch (e) {
        this.state.paused = `Không mở được Muse: ${(e as Error).message}`;
      }
    }
    this.pump();
    return this.state;
  }

  cancel(id: string): GatewayTask | undefined {
    const t = this.o.store.get(id);
    if (!t || (t.status !== "queued" && t.status !== "processing")) return t;
    if (t.status === "processing" && t.sessionId) this.o.page.cancel(t.sessionId).catch(() => {});
    return this.o.store.update(id, { status: "cancelled", step: "", error: "Đã huỷ.", finishedAt: this.o.now() });
  }

  /**
   * Kiểm tra lại task lỗi đã gửi lên Muse: đọc lại đúng phiên chat cũ và tải file nếu Muse đã làm xong — KHÔNG gửi lệnh mới,
   * không tốn lượt. (Vd. Muse làm xong nhưng câu trả lời không theo dạng thường lệ.)
   */
  recheck(id: string): GatewayTask | undefined {
    const t = this.o.store.get(id);
    if (!t || t.status !== "failed") return t;
    if (!t.sessionId) throw new InputError("Task này chưa được gửi lên Muse — không có gì để kiểm tra lại.");
    const r = this.o.store.update(id, { status: "processing", step: "Kiểm tra lại kết quả", error: "", finishedAt: 0, pollErrors: 0 });
    this.pump();
    return r;
  }

  /** Chạy lại task lỗi / đã huỷ (gửi lại bằng chat mới = tốn thêm một lượt Muse). */
  retry(id: string): GatewayTask | undefined {
    const t = this.o.store.get(id);
    if (!t || t.status === "queued" || t.status === "processing") return t;
    const r = this.o.store.update(id, { status: "queued", step: "", error: "", files: [], startedAt: 0, finishedAt: 0, sessionId: "", attempts: 0, pollErrors: 0 });
    this.pump();
    return r;
  }

  async close(): Promise<void> {
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    this.o.store.flush();
    await this.o.page.close().catch(() => {});
  }
}
