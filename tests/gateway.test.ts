// Cổng Muse với "Muse giả" (không mở Chrome, không tốn lượt): gửi lệnh, dò, tải file, lỗi, hạn mức, đăng nhập,
// tắt mở lại cổng giữa chừng, huỷ, và chặn yêu cầu không phải từ app trên máy.
import http from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseQuota, parseResult, weeklyOut } from "../gateway/musePage.ts";
import { MuseResultError, buildMessage, failurePatch, runTask } from "../gateway/runner.ts";
import { createGateway, type Gateway } from "../gateway/server.ts";
import { TaskStore, type GatewayTask } from "../gateway/tasks.ts";
import { FAST, FakeMuse, waitFor } from "./fakeMuse";

const tmp = mkdtempSync(path.join(tmpdir(), "mvps-gateway-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const newDir = () => path.join(tmp, `gw${++n}`);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call(gw: Gateway, method: string, p: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; data: any }> {
  const res = await fetch(gw.url + p, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json", ...headers } : headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get("content-type") ?? "";
  return { status: res.status, data: type.includes("json") ? await res.json() : Buffer.from(await res.arrayBuffer()) };
}
const taskOf = async (gw: Gateway, id: string) => (await call(gw, "GET", `/tasks/${id}`)).data.task as Record<string, any>;
const PNG = "data:image/png;base64," + Buffer.from("png-bytes").toString("base64");

describe("phần thuần", () => {
  it("lệnh gửi Muse, đọc kết quả, hạn mức", () => {
    expect(buildMessage({ kind: "video", ratio: "16:9", prompt: "A car at dusk." })).toBe("Tạo video · tỷ lệ 16:9 ngang\nA car at dusk.");
    expect(buildMessage({ kind: "image", ratio: "", prompt: "p" })).toBe("Tạo ảnh\np");
    const r = parseResult([
      { text: "Đây", images: [{ path: "a.png", mime: "image/png", byte_len: 3 }], videos: [{ path: "v.mp4", mime: "video/mp4", byte_len: 9 }, { path: "x.mp4", mime: "video/mp4", byte_len: 1, missing: true }] },
    ]);
    expect(r).toEqual({ files: [{ path: "v.mp4", mime: "video/mp4", byteLen: 9 }, { path: "a.png", mime: "image/png", byteLen: 3 }], text: "Đây" });
    const q = parseQuota({ tier: { name: "Muse miễn phí", isPaid: false }, usage: { percentUsed: 5, resetsAt: 1792051239, quotaStatus: "SUFFICIENT" } }, 1)!;
    expect(q).toMatchObject({ pct: 5, resetsAt: 1792051239000, tier: "Muse miễn phí", paid: false, checkedAt: 1 });
    expect(weeklyOut(q)).toBe(false);
    expect(weeklyOut({ ...q, pct: 100 })).toBe(true);
    expect(weeklyOut({ ...q, status: "QUOTA_EXHAUSTED" })).toBe(true);
    expect(parseQuota(null)).toBeNull();
  });

  it("không có thẻ video → lấy đường dẫn sandbox:// Muse ghi trong câu trả lời (gặp khi thử thật)", () => {
    const p = "sandbox://workspace/imagine_media/media-generation-1955-pier-0-89fc.mp4";
    const r = parseResult([
      { text: "", images: [], videos: [], extra: [] },
      { text: "Muốn mình làm thêm bản biến tấu khác…", images: [], videos: [], extra: [p, p, "sandbox://workspace/x/thumb.png"] },
    ]);
    expect(r.files).toEqual([
      { path: p, mime: "video/mp4", byteLen: 0 },
      { path: "sandbox://workspace/x/thumb.png", mime: "image/png", byteLen: 0 },
    ]);
    // Có thẻ video rồi thì không lặp lại cùng file.
    const withCard = parseResult([{ text: "", images: [], videos: [{ path: p, mime: "video/mp4", byte_len: 9 }], extra: [p] }]);
    expect(withCard.files).toEqual([{ path: p, mime: "video/mp4", byteLen: 9 }]);
  });

  it("sau lỗi: lỗi mạng lúc dò thì dò lại phiên cũ (không gửi lại); lỗi Muse thì thất bại, không tự tốn thêm lượt", () => {
    const t = { attempts: 1, sessionId: "s1", pollErrors: 0 } as GatewayTask;
    expect(failurePatch(t, new Error("mất mạng"), 9)).toMatchObject({ pollErrors: 1 });
    expect(failurePatch({ ...t, pollErrors: 3 }, new Error("mất mạng"), 9)).toMatchObject({ status: "failed", finishedAt: 9 });
    expect(failurePatch(t, new MuseResultError("không ra video"), 9)).toMatchObject({ status: "failed", error: "không ra video" });
    expect(failurePatch({ ...t, sessionId: "" }, new Error("x"), 9, 2)).toMatchObject({ status: "queued", sessionId: "" });
  });

  it("runTask: quá giờ thì huỷ phiên trên Muse", async () => {
    const fake = new FakeMuse();
    let clock = 0;
    const task = { id: "task_00", kind: "video", ratio: "16:9", prompt: "p", images: [], sessionId: "", startedAt: 0, timeoutMin: 0 } as unknown as GatewayTask;
    const run = runTask(task, { page: fake, update: () => {}, isLive: () => true, outputDir: newDir(), sleep: async () => void (clock += 60e3), now: () => clock, pollMs: 1 });
    await expect(run).rejects.toThrow(/Quá 30 phút/);
    expect(fake.sessions.get("sess_1")?.status).toBe("cancelled");
  });
});

describe("Cổng Muse (HTTP) với Muse giả", () => {
  it("nhận task → gửi Muse (kèm ảnh) → xong → tải file; không lộ đường dẫn nội bộ", async () => {
    const fake = new FakeMuse();
    const gw = await createGateway({ dir: newDir(), port: 0, page: fake, worker: FAST });
    try {
      const st = await call(gw, "GET", "/status");
      expect(st.data).toMatchObject({ ok: true, app: "Cổng Muse", loggedIn: null });
      const { status, data } = await call(gw, "POST", "/tasks", { prompt: " A dancer spins. ", ratio: "16:9", label: "MV · cảnh 1", images: [PNG] });
      expect(status).toBe(201);
      const id = data.task.id as string;
      expect(data.task).toMatchObject({ prompt: "A dancer spins.", kind: "video", images: 1, status: "queued" });
      await waitFor(async () => (await taskOf(gw, id)).step === "Muse đang làm", 5000, "gửi lệnh");
      expect(fake.sent[0].text).toBe("Tạo video · tỷ lệ 16:9 ngang\nA dancer spins.");
      expect(fake.sent[0].atts).toMatchObject([{ filename: "anh_1.png", mimeType: "image/png", category: "image" }]);
      expect(Buffer.from(fake.sent[0].atts[0].dataBase64, "base64").toString()).toBe("png-bytes");

      fake.finish(1);
      await waitFor(async () => (await taskOf(gw, id)).status === "succeeded", 5000, "task xong");
      const done = await taskOf(gw, id);
      expect(done.files).toEqual([`${id}_1.mp4`]);
      const file = await call(gw, "GET", `/tasks/${id}/file?i=0`);
      expect(file.status).toBe(200);
      expect((file.data as Buffer).toString()).toBe("fake-muse-video");
      expect(readFileSync(gw.store.get(id)!.files[0], "utf8")).toBe("fake-muse-video");
      expect((await call(gw, "GET", "/tasks")).data.tasks[0].id).toBe(id);
    } finally {
      await gw.close();
    }
  });

  it("Muse không ra video → thất bại kèm lời Muse; Thử lại = gửi lại bằng chat mới", async () => {
    const fake = new FakeMuse();
    const gw = await createGateway({ dir: newDir(), port: 0, page: fake, worker: FAST });
    try {
      const id = (await call(gw, "POST", "/tasks", { prompt: "p" })).data.task.id as string;
      await waitFor(() => fake.sent.length === 1, 5000, "gửi lệnh");
      fake.finish(1, false);
      await waitFor(async () => (await taskOf(gw, id)).status === "failed", 5000, "thất bại");
      expect((await taskOf(gw, id)).error).toMatch(/không tạo được video/);
      expect(fake.sent).toHaveLength(1); // không tự gửi lại

      await call(gw, "POST", `/tasks/${id}/retry`, {});
      await waitFor(() => fake.sent.length === 2, 5000, "gửi lại");
      fake.finish(2);
      await waitFor(async () => (await taskOf(gw, id)).status === "succeeded", 5000, "xong");
    } finally {
      await gw.close();
    }
  });

  it("Kiểm tra lại task lỗi: đọc lại phiên cũ, tải video nếu Muse đã làm — không gửi lại; chưa gửi thì báo lỗi", async () => {
    const fake = new FakeMuse();
    const gw = await createGateway({ dir: newDir(), port: 0, page: fake, worker: FAST });
    try {
      const id = (await call(gw, "POST", "/tasks", { prompt: "p" })).data.task.id as string;
      await waitFor(() => fake.sent.length === 1, 5000, "gửi lệnh");
      fake.finish(1, false); // lúc đầu không thấy video
      await waitFor(async () => (await taskOf(gw, id)).status === "failed", 5000, "thất bại");
      fake.sessions.get("sess_1")!.ok = true; // thật ra Muse đã làm xong video
      expect((await call(gw, "POST", `/tasks/${id}/recheck`, {})).status).toBe(200);
      await waitFor(async () => (await taskOf(gw, id)).status === "succeeded", 5000, "kiểm tra lại xong");
      expect(fake.sent).toHaveLength(1); // không gửi lại

      fake.loggedIn = false; // task mới không gửi được → vẫn đang chờ
      const id2 = (await call(gw, "POST", "/tasks", { prompt: "q" })).data.task.id as string;
      gw.store.update(id2, { status: "failed" });
      expect((await call(gw, "POST", `/tasks/${id2}/recheck`, {})).status).toBe(400);
    } finally {
      await gw.close();
    }
  });

  it("chưa đăng nhập → chờ; Đăng nhập Muse → hiện Chrome, đăng nhập xong thì chạy", async () => {
    const fake = new FakeMuse();
    fake.loggedIn = false;
    const gw = await createGateway({ dir: newDir(), port: 0, page: fake, worker: FAST });
    try {
      const id = (await call(gw, "POST", "/tasks", { prompt: "p" })).data.task.id as string;
      await waitFor(async () => /Chưa đăng nhập/.test((await call(gw, "GET", "/status")).data.paused), 5000, "báo chưa đăng nhập");
      expect(fake.sent).toHaveLength(0);
      expect((await call(gw, "POST", "/login", {})).status).toBe(202);
      await waitFor(() => fake.shown === 1, 5000, "hiện Chrome");
      fake.loggedIn = true;
      await waitFor(() => fake.sent.length === 1, 5000, "gửi sau khi đăng nhập");
      expect(fake.hidden).toBeGreaterThan(0);
      expect((await call(gw, "GET", "/status")).data).toMatchObject({ loggedIn: true, paused: "", quota: { pct: 5 } });
      expect((await taskOf(gw, id)).status).toBe("processing");

      // Người dùng đóng cửa sổ Chrome → task sau chờ, không tự mở lại Chrome.
      fake.userCloses();
      fake.finish(1);
      const id2 = (await call(gw, "POST", "/tasks", { prompt: "q" })).data.task.id as string;
      await waitFor(async () => /đã bị đóng/.test((await call(gw, "GET", "/status")).data.paused), 5000, "báo Chrome đóng");
      expect((await taskOf(gw, id2)).status).toBe("queued");
      await call(gw, "POST", "/login", {});
      await waitFor(() => fake.sent.length === 2, 5000, "chạy lại sau khi mở Chrome");
    } finally {
      await gw.close();
    }
  });

  it("hết hạn mức tuần → không gửi, báo ngày đặt lại", async () => {
    const fake = new FakeMuse();
    fake.quotaPct = 100;
    const gw = await createGateway({ dir: newDir(), port: 0, page: fake, worker: FAST });
    try {
      const id = (await call(gw, "POST", "/tasks", { prompt: "p" })).data.task.id as string;
      await waitFor(async () => /Hết hạn mức/.test((await call(gw, "GET", "/status")).data.paused), 5000, "báo hết hạn mức");
      expect(fake.sent).toHaveLength(0);
      expect((await taskOf(gw, id)).status).toBe("queued");
    } finally {
      await gw.close();
    }
  });

  it("tắt cổng khi Muse đang làm → mở lại thì dò tiếp đúng phiên, không gửi lại", async () => {
    const dir = newDir();
    const fake = new FakeMuse();
    let gw = await createGateway({ dir, port: 0, page: fake, worker: FAST });
    const id = (await call(gw, "POST", "/tasks", { prompt: "p" })).data.task.id as string;
    await waitFor(() => fake.sent.length === 1, 5000, "gửi lệnh");
    await waitFor(() => gw.store.get(id)?.sessionId === "sess_1", 5000, "lưu phiên");
    await gw.close();
    expect(new TaskStore(dir).get(id)).toMatchObject({ status: "processing", sessionId: "sess_1" });

    gw = await createGateway({ dir, port: 0, page: fake, worker: FAST });
    try {
      fake.finish(1);
      await waitFor(async () => (await taskOf(gw, id)).status === "succeeded", 5000, "xong sau khi mở lại");
      expect(fake.sent).toHaveLength(1);
    } finally {
      await gw.close();
    }
  });

  it("huỷ task đang làm → huỷ luôn phiên trên Muse", async () => {
    const fake = new FakeMuse();
    const gw = await createGateway({ dir: newDir(), port: 0, page: fake, worker: FAST });
    try {
      const id = (await call(gw, "POST", "/tasks", { prompt: "p" })).data.task.id as string;
      await waitFor(() => fake.sent.length === 1, 5000, "gửi lệnh");
      await waitFor(() => Boolean(gw.store.get(id)?.sessionId), 5000, "lưu phiên");
      expect((await call(gw, "POST", `/tasks/${id}/cancel`, {})).data.task.status).toBe("cancelled");
      expect(fake.sessions.get("sess_1")?.status).toBe("cancelled");
    } finally {
      await gw.close();
    }
  });

  it("chặn yêu cầu từ trang web, Host lạ, POST không phải JSON; báo lỗi dữ liệu", async () => {
    const gw = await createGateway({ dir: newDir(), port: 0, page: new FakeMuse(), worker: FAST });
    try {
      expect((await call(gw, "GET", "/status", undefined, { Origin: "https://evil.example" })).status).toBe(403);
      expect((await call(gw, "GET", "/status", undefined, { "Sec-Fetch-Site": "cross-site" })).status).toBe(403);
      const plain = await fetch(gw.url + "/tasks", { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ prompt: "p" }) });
      expect(plain.status).toBe(403);
      const badHost = await new Promise<number>((resolve, reject) => {
        http.get({ host: "127.0.0.1", port: gw.port, path: "/status", headers: { Host: `evil.example:${gw.port}` } }, (res) => resolve(res.statusCode ?? 0)).on("error", reject);
      });
      expect(badHost).toBe(403);
      expect((await call(gw, "POST", "/tasks", { prompt: "" })).status).toBe(400);
      expect((await call(gw, "POST", "/tasks", { prompt: "p", images: ["http://x/y.png"] })).status).toBe(400);
      expect((await call(gw, "GET", "/tasks/task_0123456789abcdef")).status).toBe(404);
      expect(gw.store.list()).toHaveLength(0);
    } finally {
      await gw.close();
    }
  });
});
