// CHROME — mở Google Chrome thật của máy với profile riêng, điều khiển qua CDP bằng pipe (chỉ dùng phía server)
// (fd 3 = app ghi lệnh, fd 4 = Chrome trả lời; mỗi tin là JSON kết thúc bằng \0). Không mở cổng debug nào ra mạng.
// Chrome 136+ không cho điều khiển profile chính → dùng thư mục profile riêng (người dùng tự đăng nhập Muse trong đó).
// Tiến trình của app tắt thì Chrome này cũng tự tắt (pipe bị đóng).

import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { Readable, Writable } from "node:stream";

const IS_MAC = process.platform === "darwin";

/** Chrome của máy: Mac trong /Applications; Windows trong Program Files hoặc AppData\Local (cài riêng một người dùng). */
export function findChrome(): string | null {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const list = IS_MAC
    ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
    : process.platform === "win32"
      ? [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA]
          .filter((d): d is string => Boolean(d))
          .map((d) => path.join(/*turbopackIgnore: true*/ d, "Google", "Chrome", "Application", "chrome.exe"))
      : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"];
  return list.find((p) => existsSync(p)) ?? null;
}

// Windows không có "ẩn app" như Mac → đẩy cửa sổ ra ngoài màn hình (JS vẫn chạy bình thường).
const OFF = { left: -32000, top: -32000 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Cửa sổ ẩn / thu nhỏ: trang không chạy requestAnimationFrame và báo "hidden" → Muse (Next.js) không dựng xong khung chat.
// Nạp trước mỗi trang: báo luôn "visible"; rAF không chạy thì dùng setTimeout 16 ms thay.
const VISIBLE_SHIM = `(() => {
  Object.defineProperty(Document.prototype, 'visibilityState', { get: () => 'visible', configurable: true });
  Object.defineProperty(Document.prototype, 'hidden', { get: () => false, configurable: true });
  const raf = window.requestAnimationFrame.bind(window), caf = window.cancelAnimationFrame.bind(window);
  const t = new Map(); let seq = 0;
  window.requestAnimationFrame = cb => {
    const id = ++seq; let done = false;
    const run = ts => { if (done) return; done = true; t.delete(id); cb(ts); };
    t.set(id, [raf(run), setTimeout(() => run(performance.now()), 16)]);
    return id;
  };
  window.cancelAnimationFrame = id => { const v = t.get(id); if (v) { caf(v[0]); clearTimeout(v[1]); t.delete(id); } };
})();`;

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

export interface ChromeOptions {
  profileDir: string;
  url: string;
  chromePath?: string | null;
}

/** Sự kiện "exit" { byUser }: Chrome đã tắt — byUser = người dùng tự đóng cửa sổ (không phải app đóng). */
export class Chrome extends EventEmitter {
  profileDir: string;
  url: string;
  chromePath: string | null;
  proc: ChildProcess | null = null;
  sessionId = "";
  targetId = "";
  private seq = 0;
  private pending = new Map<number, Pending>();
  private starting: Promise<void> | null = null;
  private closing = false;

  constructor(opts: ChromeOptions) {
    super();
    this.profileDir = opts.profileDir;
    this.url = opts.url;
    this.chromePath = opts.chromePath === undefined ? findChrome() : opts.chromePath;
  }

  /** Sẵn sàng = Chrome chạy VÀ đang gắn vào một tab. */
  get running(): boolean {
    return Boolean(this.proc && this.sessionId);
  }

  /** Gọi chồng nhau thì dùng chung một lần mở. */
  start(): Promise<void> {
    this.starting ??= this.launch().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async launch(): Promise<void> {
    if (this.proc) return this.attach();
    if (!this.chromePath || !existsSync(this.chromePath)) throw new Error("Không tìm thấy Google Chrome — cài Google Chrome rồi mở lại app.");
    mkdirSync(this.profileDir, { recursive: true });
    const proc = spawn(
      /*turbopackIgnore: true*/ this.chromePath,
      [
        `--user-data-dir=${this.profileDir}`,
        "--remote-debugging-pipe",
        "--no-first-run",
        "--no-default-browser-check",
        // Chrome thu nhỏ / bị che vẫn phải chạy JS bình thường để dò tiến độ Muse
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
        ...(IS_MAC ? [] : [`--window-position=${OFF.left},${OFF.top}`]), // mở sẵn ngoài màn hình, không nháy
        "about:blank", // mở trang trắng, gắn VISIBLE_SHIM rồi mới vào Muse
      ],
      { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] },
    );
    this.proc = proc;
    this.closing = false;
    let buf = "";
    (proc.stdio[4] as Readable).on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      let i;
      while ((i = buf.indexOf("\0")) >= 0) {
        const msg = JSON.parse(buf.slice(0, i)) as { id?: number; method?: string; params?: { sessionId?: string }; result?: unknown; error?: { message: string } };
        buf = buf.slice(i + 1);
        // Tab Muse bị đóng → bỏ phiên tab, lần gọi sau start() gắn lại
        if (msg.method === "Target.detachedFromTarget" && msg.params?.sessionId === this.sessionId) this.sessionId = "";
        const p = msg.id === undefined ? undefined : this.pending.get(msg.id);
        if (!p) continue;
        this.pending.delete(msg.id!);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
      }
    });
    (proc.stdio[3] as Writable).on("error", () => {});
    proc.once("exit", () => this.onExit(proc));

    try {
      await this.attach();
      await this.cmd("Page.navigate", { url: this.url }, this.sessionId);
    } catch (e) {
      await this.close();
      throw e;
    }
  }

  /** Gắn vào tab muse.ai (hoặc tab đầu tiên); không còn tab nào → mở tab mới. */
  private async attach(): Promise<void> {
    let target: { targetId: string; url: string; type: string } | undefined;
    for (let k = 0; k < 10 && !target; k++) {
      const { targetInfos } = (await this.cmd("Target.getTargets")) as { targetInfos: { targetId: string; url: string; type: string }[] };
      const pages = targetInfos.filter((t) => t.type === "page");
      target = pages.find((t) => t.url.includes("muse.ai")) ?? pages[0];
      if (!target) await sleep(200);
    }
    const targetId = target ? target.targetId : ((await this.cmd("Target.createTarget", { url: this.url })) as { targetId: string }).targetId;
    const { sessionId } = (await this.cmd("Target.attachToTarget", { targetId, flatten: true })) as { sessionId: string };
    await this.cmd("Page.enable", {}, sessionId); // thiếu Page.enable thì script nạp trước không chạy
    await this.cmd("Page.addScriptToEvaluateOnNewDocument", { source: VISIBLE_SHIM }, sessionId);
    this.targetId = targetId;
    this.sessionId = sessionId;
  }

  private onExit(proc: ChildProcess) {
    if (this.proc !== proc) return;
    this.proc = null;
    this.sessionId = "";
    for (const p of this.pending.values()) p.reject(new Error("Chrome đã đóng"));
    this.pending.clear();
    this.emit("exit", { byUser: !this.closing });
  }

  /** Lệnh CDP; sessionId = lệnh cho tab Muse, không có = lệnh cho cả trình duyệt. Quá thời gian không trả lời → lỗi. */
  cmd(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs = 60e3): Promise<unknown> {
    const proc = this.proc;
    if (!proc) return Promise.reject(new Error("Chrome đã đóng"));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Chrome không trả lời ${method} (quá ${timeoutMs / 1000}s)`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      (proc.stdio[3] as Writable).write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0");
    });
  }

  async evaluate(expression: string, timeoutMs?: number): Promise<unknown> {
    if (this.proc && !this.sessionId) throw new Error("Chrome mất tab Muse");
    const r = (await this.cmd("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, this.sessionId, timeoutMs)) as {
      result: { value: unknown };
      exceptionDetails?: { text: string; exception?: { description?: string } };
    };
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }

  /** Về cửa sổ thường rồi mới đặt vị trí (Chrome không cho đổi vị trí khi đang thu nhỏ / phóng to). */
  private async setWindow(bounds: Record<string, unknown> | null) {
    const { windowId } = (await this.cmd("Browser.getWindowForTarget", { targetId: this.targetId })) as { windowId: number };
    await this.cmd("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
    if (bounds) await this.cmd("Browser.setWindowBounds", { windowId, bounds });
  }

  /** Hiện cửa sổ Chrome (để đăng nhập Muse). */
  async show() {
    await this.setWindow({ left: 80, top: 40, width: 1200, height: 860 });
    await this.cmd("Target.activateTarget", { targetId: this.targetId });
  }

  /** Cất cửa sổ đi: Windows đẩy ra ngoài màn hình, Mac thu nhỏ (trang vẫn chạy nhờ VISIBLE_SHIM). */
  async hide() {
    if (!this.proc) return;
    if (!IS_MAC) return this.setWindow(OFF);
    const { windowId } = (await this.cmd("Browser.getWindowForTarget", { targetId: this.targetId })) as { windowId: number };
    await this.cmd("Browser.setWindowBounds", { windowId, bounds: { windowState: "minimized" } });
  }

  async close() {
    const proc = this.proc;
    if (!proc) return;
    this.closing = true;
    const exited = new Promise((r) => proc.once("exit", r));
    this.cmd("Browser.close").catch(() => {});
    const timer = setTimeout(() => proc.kill(), 3000);
    await exited;
    clearTimeout(timer);
  }
}
