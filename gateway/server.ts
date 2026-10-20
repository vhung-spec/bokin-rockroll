// CỔNG MUSE — server riêng trên máy (mặc định http://127.0.0.1:18700) nhận task tạo video / ảnh, chạy trên Muse qua Chrome,
// cho xem trạng thái và tải file kết quả. Chạy: node gateway/server.ts   (file khởi động của app tự mở cổng này).
//
// Không có API key (theo yêu cầu). Bù lại: chỉ nghe ở 127.0.0.1, chỉ nhận Host 127.0.0.1 / localhost đúng cổng (chặn DNS rebinding),
// từ chối mọi yêu cầu đến từ trang web (có Origin / Sec-Fetch-Site) và POST không phải JSON — trang web lạ mở trong trình duyệt không gọi được.
//
//   GET  /status                    đăng nhập, hạn mức tuần, hàng đợi đang dừng vì sao, số task theo trạng thái
//   POST /login                     hiện Chrome của cổng để đăng nhập Muse (trả về ngay)
//   POST /check                     kiểm tra lại đăng nhập + hạn mức
//   GET  /tasks?status=&limit=      danh sách task (mới nhất trước)
//   POST /tasks                     { prompt, kind?: "video"|"image", ratio?: "16:9"…, label?, images?: [data URL], timeoutMin? }
//   GET  /tasks/:id                 một task
//   POST /tasks/:id/cancel | /retry (gửi lại = tốn lượt) | /recheck (đọc lại phiên cũ, không gửi lại)
//   GET  /tasks/:id/file?i=0        tải file kết quả thứ i
//   GET  /tasks/:id/history         chẩn đoán: tóm tắt cuộc chat Muse của task (chỉ đọc)

import { createReadStream, existsSync, renameSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Chrome } from "./chrome.ts";
import { MusePage, type MuseDriver } from "./musePage.ts";
import { Worker, type WorkerOptions } from "./runner.ts";
import { InputError, TaskStore, type GatewayTask } from "./tasks.ts";

export const DEFAULT_PORT = 18700;
const MAX_BODY = 40 * 1024 * 1024;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT_TYPE: Record<string, string> = { ".mp4": "video/mp4", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg" };

/** Task gửi ra ngoài: không lộ đường dẫn nội bộ (ảnh → số lượng, file → tên). */
export function publicTask(t: GatewayTask) {
  return {
    id: t.id,
    label: t.label,
    prompt: t.prompt,
    kind: t.kind,
    ratio: t.ratio,
    images: t.images.length,
    status: t.status,
    step: t.step,
    attempts: t.attempts,
    createdAt: t.createdAt,
    startedAt: t.startedAt,
    finishedAt: t.finishedAt,
    files: t.files.map((f) => path.basename(f)),
    error: t.error,
  };
}

/** Lý do từ chối (hoặc null nếu cho qua). */
function refuse(req: http.IncomingMessage, port: number): string | null {
  const host = String(req.headers.host ?? "").toLowerCase();
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return "Host không hợp lệ.";
  const site = req.headers["sec-fetch-site"];
  if (req.headers.origin || (site && site !== "none")) return "Cổng Muse chỉ nhận yêu cầu từ app trên máy này, không nhận từ trang web.";
  if (req.method === "POST" && !/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) return "Cần Content-Type: application/json.";
  return null;
}

function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new InputError("Dữ liệu gửi lên quá lớn (tối đa 40 MB)."));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? (JSON.parse(text) as Record<string, unknown>) : {});
      } catch {
        reject(new InputError("Dữ liệu không phải JSON hợp lệ."));
      }
    });
    req.on("error", reject);
  });
}

export interface GatewayOptions {
  /** Thư mục dữ liệu của cổng (hàng đợi, video, profile Chrome). */
  dir: string;
  /** 0 = chọn cổng trống (dùng khi test). */
  port?: number;
  /** Trang Muse (mặc định: Chrome thật với profile riêng trong <dir>/chrome-profile). */
  page?: MuseDriver;
  worker?: Partial<Omit<WorkerOptions, "store" | "page" | "outputDir">>;
}

export interface Gateway {
  port: number;
  url: string;
  store: TaskStore;
  worker: Worker;
  close(): Promise<void>;
}

export async function createGateway(opts: GatewayOptions): Promise<Gateway> {
  const store = new TaskStore(opts.dir);
  const page = opts.page ?? new MusePage(new Chrome({ profileDir: path.join(opts.dir, "chrome-profile"), url: "https://muse.ai" }));
  const worker = new Worker({ store, page, outputDir: path.join(opts.dir, "videos"), ...opts.worker });
  let port = opts.port ?? DEFAULT_PORT;

  const status = () => {
    const counts: Record<string, number> = { queued: 0, processing: 0, succeeded: 0, failed: 0, cancelled: 0 };
    for (const t of store.list()) counts[t.status]++;
    return { ok: true, app: "Cổng Muse", version: 1, ...worker.state, counts };
  };

  const server = http.createServer((req, res) => {
    const send = (code: number, data: unknown) => {
      res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(data));
    };
    const handle = async () => {
      const why = refuse(req, port);
      if (why) return send(403, { error: why });
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      const p = url.pathname.replace(/\/+$/, "") || "/";

      if (req.method === "GET" && p === "/status") return send(200, status());
      if (req.method === "POST" && p === "/login") {
        void worker.login();
        return send(202, { ok: true, message: "Đã mở Chrome của cổng — đăng nhập Muse trong cửa sổ đó." });
      }
      if (req.method === "POST" && p === "/check") {
        await worker.check();
        return send(200, status());
      }
      if (p === "/tasks") {
        if (req.method === "GET") {
          const limit = Math.min(Number(url.searchParams.get("limit")) || 100, 1000);
          return send(200, { tasks: store.list(url.searchParams.get("status") ?? undefined).slice(0, limit).map(publicTask) });
        }
        if (req.method === "POST") {
          const body = await readJson(req);
          const task = store.add({
            prompt: String(body.prompt ?? ""),
            kind: typeof body.kind === "string" ? body.kind : undefined,
            ratio: typeof body.ratio === "string" ? body.ratio : undefined,
            label: typeof body.label === "string" ? body.label : undefined,
            images: Array.isArray(body.images) ? body.images.map(String) : undefined,
            timeoutMin: Number(body.timeoutMin) || undefined,
          });
          worker.pump();
          return send(201, { task: publicTask(task) });
        }
      }
      const m = /^\/tasks\/(task_[0-9a-f]+)(\/cancel|\/retry|\/recheck|\/file|\/history)?$/.exec(p);
      if (m) {
        const [, id, action = ""] = m;
        const task = store.get(id);
        if (!task) return send(404, { error: "Không có task này." });
        if (req.method === "GET" && !action) return send(200, { task: publicTask(task) });
        if (req.method === "POST" && action === "/cancel") return send(200, { task: publicTask(worker.cancel(id) ?? task) });
        if (req.method === "POST" && action === "/retry") return send(200, { task: publicTask(worker.retry(id) ?? task) });
        if (req.method === "POST" && action === "/recheck") return send(200, { task: publicTask(worker.recheck(id) ?? task) });
        if (req.method === "GET" && action === "/history") {
          if (!task.sessionId || !page.history) return send(404, { error: "Task chưa có phiên chat Muse." });
          return send(200, { history: await page.history(task.sessionId) });
        }
        if (req.method === "GET" && action === "/file") {
          const file = task.files[Number(url.searchParams.get("i")) || 0];
          if (!file || !existsSync(file)) return send(404, { error: "Task chưa có file này." });
          res.writeHead(200, {
            "Content-Type": CONTENT_TYPE[path.extname(file).toLowerCase()] ?? "application/octet-stream",
            "Content-Length": statSync(file).size,
            "Content-Disposition": `attachment; filename="${path.basename(file)}"`,
          });
          createReadStream(file).pipe(res);
          return;
        }
      }
      return send(404, { error: "Không có đường dẫn này." });
    };
    handle().catch((err: Error) => {
      if (res.headersSent) return res.end();
      send(err instanceof InputError ? 400 : 500, { error: err.message });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  port = (server.address() as { port: number }).port;
  // Có task dở từ lần chạy trước → chạy tiếp.
  if (store.list().some((t) => t.status === "queued" || t.status === "processing")) worker.pump();

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    store,
    worker,
    async close() {
      await new Promise<void>((r) => server.close(() => r()));
      server.closeAllConnections();
      await worker.close();
    },
  };
}

// ---------- Chạy trực tiếp: node gateway/server.ts ----------

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  // Dữ liệu cổng nằm NGOÀI thư mục dự án (thư mục kế bên, cùng ổ đĩa): lúc build, Next.js đọc file trong thư mục dự án và sẽ vấp
  // vào profile Chrome đang mở (có phiên đăng nhập Muse, file bị Chrome khoá).
  const dir = process.env.MUSE_GATEWAY_DIR ? path.resolve(process.env.MUSE_GATEWAY_DIR) : path.join(path.dirname(ROOT), `${path.basename(ROOT)}-muse-gateway`);
  for (const old of [path.join(ROOT, "gateway-data"), path.join(ROOT, "data", "gateway")]) {
    if (process.env.MUSE_GATEWAY_DIR || existsSync(dir) || !existsSync(old)) continue;
    renameSync(old, dir); // bản trước để trong thư mục dự án → chuyển sang chỗ mới, giữ nguyên phiên đăng nhập
    console.log(`▶ Đã chuyển dữ liệu Cổng Muse từ ${old} sang ${dir}`);
  }
  const port = Number(process.env.MUSE_GATEWAY_PORT) || DEFAULT_PORT;
  try {
    const gw = await createGateway({ dir, port });
    console.log(`▶ Cổng Muse đang chạy tại ${gw.url} (dữ liệu: ${dir})`);
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      gw.close().finally(() => process.exit(0));
    };
    for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sig, stop);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    console.error(e.code === "EADDRINUSE" ? `Cổng ${port} đang bận (có thể Cổng Muse đã chạy ở cửa sổ khác).` : `Không khởi động được Cổng Muse: ${e.message}`);
    process.exit(1);
  }
}
