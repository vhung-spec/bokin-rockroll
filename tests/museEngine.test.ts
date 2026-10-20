// Muse trong app với "Muse giả" (không mở Chrome, không tốn lượt): gửi lệnh, dò, tải file, lỗi, kiểm tra lại, hạn mức,
// Muse báo hết hạn mức, đăng nhập, tắt mở lại app giữa chừng, huỷ, dữ liệu gửi lên không hợp lệ.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { closeMuseEngine, engineStatus, initMuseEngine } from "@/lib/museEngine";
import { parseQuota, parseResult, weeklyOut } from "@/lib/museEngine/page";
import { LIMIT_RE, MuseResultError, Worker, buildMessage, failurePatch, runTask } from "@/lib/museEngine/runner";
import { InputError, TaskStore, type GatewayTask } from "@/lib/museEngine/tasks";
import { FAST, FakeMuse, waitFor } from "./fakeMuse";

const tmp = mkdtempSync(path.join(tmpdir(), "mvps-engine-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const newDir = () => path.join(tmp, `e${++n}`);
const PNG = "data:image/png;base64," + Buffer.from("png-bytes").toString("base64");

/** Hàng đợi + Worker với Muse giả, dò rất nhanh. */
function setup(fake = new FakeMuse(), dir = newDir()) {
  const store = new TaskStore(dir);
  const worker = new Worker({ store, page: fake, outputDir: path.join(dir, "videos"), ...FAST });
  const add = (prompt = "p", extra: Partial<Parameters<TaskStore["add"]>[0]> = {}) => {
    const t = store.add({ prompt, ...extra });
    worker.pump();
    return t.id;
  };
  const status = (id: string) => store.get(id)!.status;
  return { fake, dir, store, worker, add, status };
}

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

  it("nhận ra Muse báo hết hạn mức, không nhầm câu trả lời thường", () => {
    for (const s of ["You've reached your weekly usage limit.", "Muse không nhận lệnh: quota_exceeded", "Bạn đã dùng hết hạn mức tuần này", "Please upgrade your plan to continue"]) {
      expect(LIMIT_RE.test(s)).toBe(true);
    }
    for (const s of ["Muốn mình làm thêm bản biến tấu khác — cứ nói nhé.", "Đã xong — cảnh hoàng hôn ven biển.", "Muse không trả về video (phiên completed)."]) {
      expect(LIMIT_RE.test(s)).toBe(false);
    }
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

describe("hàng đợi Muse trong app (Muse giả)", () => {
  it("nhận task → gửi Muse (kèm ảnh) → xong → có file video", async () => {
    const { fake, store, worker, add, status } = setup();
    const id = add(" A dancer spins. ", { ratio: "16:9", label: "MV · cảnh 1", images: [PNG] });
    expect(store.get(id)).toMatchObject({ prompt: "A dancer spins.", kind: "video" });
    await waitFor(() => store.get(id)!.step === "Muse đang làm", 5000, "gửi lệnh");
    expect(fake.sent[0].text).toBe("Tạo video · tỷ lệ 16:9 ngang\nA dancer spins.");
    expect(fake.sent[0].atts).toMatchObject([{ filename: "anh_1.png", mimeType: "image/png", category: "image" }]);
    expect(Buffer.from(fake.sent[0].atts[0].dataBase64, "base64").toString()).toBe("png-bytes");
    fake.finish(1);
    await waitFor(() => status(id) === "succeeded", 5000, "task xong");
    expect(path.basename(store.get(id)!.files[0])).toBe(`${id}_1.mp4`);
    expect(readFileSync(store.get(id)!.files[0], "utf8")).toBe("fake-muse-video");
    await worker.close();
  });

  it("Muse không ra video → thất bại kèm lời Muse; Thử lại = gửi lại bằng chat mới", async () => {
    const { fake, store, worker, add, status } = setup();
    const id = add();
    await waitFor(() => fake.sent.length === 1, 5000, "gửi lệnh");
    fake.finish(1, false);
    await waitFor(() => status(id) === "failed", 5000, "thất bại");
    expect(store.get(id)!.error).toMatch(/không tạo được video/);
    expect(fake.sent).toHaveLength(1); // không tự gửi lại
    worker.retry(id);
    await waitFor(() => fake.sent.length === 2, 5000, "gửi lại");
    fake.finish(2);
    await waitFor(() => status(id) === "succeeded", 5000, "xong");
    await worker.close();
  });

  it("Kiểm tra lại task lỗi: đọc lại phiên cũ, tải video nếu Muse đã làm — không gửi lại; chưa gửi thì báo lỗi", async () => {
    const { fake, store, worker, add, status } = setup();
    const id = add();
    await waitFor(() => fake.sent.length === 1, 5000, "gửi lệnh");
    fake.finish(1, false);
    await waitFor(() => status(id) === "failed", 5000, "thất bại");
    fake.sessions.get("sess_1")!.ok = true; // thật ra Muse đã làm xong video
    worker.recheck(id);
    await waitFor(() => status(id) === "succeeded", 5000, "kiểm tra lại xong");
    expect(fake.sent).toHaveLength(1);
    const id2 = store.add({ prompt: "q" }).id;
    store.update(id2, { status: "failed" });
    expect(() => worker.recheck(id2)).toThrow(InputError);
    await worker.close();
  });

  it("chưa đăng nhập → chờ; Đăng nhập Muse → hiện Chrome, đăng nhập xong thì chạy; đóng Chrome thì không tự mở lại", async () => {
    const fake = new FakeMuse();
    fake.loggedIn = false;
    const { store, worker, add, status } = setup(fake);
    const id = add();
    await waitFor(() => /Chưa đăng nhập/.test(worker.state.paused), 5000, "báo chưa đăng nhập");
    expect(fake.sent).toHaveLength(0);
    void worker.login();
    await waitFor(() => fake.shown === 1, 5000, "hiện Chrome");
    fake.loggedIn = true;
    await waitFor(() => fake.sent.length === 1, 5000, "gửi sau khi đăng nhập");
    expect(fake.hidden).toBeGreaterThan(0);
    expect(worker.state).toMatchObject({ loggedIn: true, paused: "", quota: { pct: 5 } });
    expect(status(id)).toBe("processing");

    fake.userCloses();
    fake.finish(1);
    const id2 = add("q");
    await waitFor(() => /đã bị đóng/.test(worker.state.paused), 5000, "báo Chrome đóng");
    expect(store.get(id2)!.status).toBe("queued");
    void worker.login();
    await waitFor(() => fake.sent.length === 2, 5000, "chạy lại sau khi mở Chrome");
    await worker.close();
  });

  it("hết hạn mức tuần (đọc được %) → không gửi, báo ngày đặt lại", async () => {
    const fake = new FakeMuse();
    fake.quotaPct = 100;
    const { worker, add, status } = setup(fake);
    const id = add();
    await waitFor(() => /Hết hạn mức/.test(worker.state.paused), 5000, "báo hết hạn mức");
    expect(fake.sent).toHaveLength(0);
    expect(status(id)).toBe("queued");
    await worker.close();
  });

  it("Muse báo hết hạn mức khi từ chối lệnh → dừng hàng đợi, không tính lượt; bấm Kiểm tra thì chạy tiếp", async () => {
    const fake = new FakeMuse();
    fake.refuse = "You've reached your weekly usage limit";
    const { store, worker, add, status } = setup(fake);
    const id = add();
    const id2 = add("q");
    await waitFor(() => /hết hạn mức/.test(worker.state.paused), 5000, "tạm dừng vì hết hạn mức");
    expect(store.get(id)).toMatchObject({ status: "queued", attempts: 0 });
    expect(status(id2)).toBe("queued"); // task sau không bị đẩy vào lỗi
    fake.refuse = "";
    await worker.check();
    await waitFor(() => fake.sent.length === 1, 5000, "chạy tiếp sau khi Kiểm tra");
    await worker.close();
  });

  it("tắt app khi Muse đang làm → mở lại thì dò tiếp đúng phiên, không gửi lại", async () => {
    const fake = new FakeMuse();
    const dir = newDir();
    const a = setup(fake, dir);
    const id = a.add();
    await waitFor(() => a.store.get(id)?.sessionId === "sess_1", 5000, "lưu phiên");
    await a.worker.close();
    expect(new TaskStore(dir).get(id)).toMatchObject({ status: "processing", sessionId: "sess_1" });

    const engine = initMuseEngine({ dir, page: fake, worker: FAST }); // mở lại: tự chạy tiếp task dở
    try {
      fake.finish(1);
      await waitFor(() => engine.store.get(id)?.status === "succeeded", 5000, "xong sau khi mở lại");
      expect(fake.sent).toHaveLength(1);
      expect(engineStatus(engine)).toMatchObject({ fake: false, dir, counts: { succeeded: 1, queued: 0 } });
    } finally {
      await closeMuseEngine();
    }
  });

  it("huỷ task đang làm → huỷ luôn phiên trên Muse; dữ liệu gửi lên không hợp lệ thì báo lỗi", async () => {
    const { fake, store, worker, add } = setup();
    const id = add();
    await waitFor(() => Boolean(store.get(id)?.sessionId), 5000, "lưu phiên");
    expect(worker.cancel(id)?.status).toBe("cancelled");
    expect(fake.sessions.get("sess_1")?.status).toBe("cancelled");
    expect(() => store.add({ prompt: "" })).toThrow(InputError);
    expect(() => store.add({ prompt: "p", images: ["http://x/y.png"] })).toThrow(/data URL/);
    await worker.close();
  });
});
