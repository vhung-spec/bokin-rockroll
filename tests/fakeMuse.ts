// "Muse giả" cho test Muse trong app: không mở Chrome, không tốn lượt. Mỗi lệnh gửi lên thành một phiên "running"; test tự cho xong / lỗi.
import type { Attachment, MuseDriver, MuseFile, Quota } from "@/lib/museEngine/page";

export class FakeMuse implements MuseDriver {
  loggedIn = true;
  quotaPct = 5;
  /** Khác "" → Muse không nhận lệnh, kèm lý do này. */
  refuse = "";
  /** Nội dung file video Muse "làm" ra. */
  video: Buffer;
  sent: { text: string; atts: Attachment[] }[] = [];
  sessions = new Map<string, { status: string; ok: boolean }>();
  shown = 0;
  hidden = 0;
  private closeFns: (() => void)[] = [];

  constructor(video: Buffer = Buffer.from("fake-muse-video")) {
    this.video = video;
  }

  async login() {
    return { loggedIn: this.loggedIn };
  }

  async send(text: string, atts: Attachment[]) {
    if (this.refuse) return { ok: false, sessionId: "", reason: this.refuse };
    this.sent.push({ text, atts });
    const sessionId = `sess_${this.sent.length}`;
    this.sessions.set(sessionId, { status: "running", ok: true });
    return { ok: true, sessionId, reason: "" };
  }

  async status(sid: string) {
    return this.sessions.get(sid)?.status ?? null;
  }

  async result(sid: string): Promise<{ files: MuseFile[]; text: string }> {
    const s = this.sessions.get(sid);
    return s?.ok
      ? { files: [{ path: `sandbox://out/${sid}.mp4`, mime: "video/mp4", byteLen: this.video.length }], text: "" }
      : { files: [], text: "Xin lỗi, tôi không tạo được video này." };
  }

  async readFile() {
    return this.video;
  }

  async cancel(sid: string) {
    const s = this.sessions.get(sid);
    if (s) s.status = "cancelled";
  }

  async quota(): Promise<Quota> {
    const out = this.quotaPct >= 100;
    return { pct: this.quotaPct, resetsAt: Date.now() + 86400e3, status: out ? "QUOTA_EXHAUSTED" : "SUFFICIENT", tier: "Muse miễn phí", paid: false, label: "", subtitle: "", checkedAt: Date.now() };
  }

  async show() {
    this.shown++;
  }

  async hide() {
    this.hidden++;
  }

  async close() {}

  onUserClose(fn: () => void) {
    this.closeFns.push(fn);
  }

  /** Người dùng tự đóng cửa sổ Chrome của cổng. */
  userCloses() {
    for (const f of this.closeFns) f();
  }

  /** Muse làm xong phiên thứ n (đếm từ 1): ok = có video, không thì trả lời bằng chữ. */
  finish(n: number, ok = true) {
    const s = this.sessions.get(`sess_${n}`);
    if (!s) throw new Error(`Chưa có phiên sess_${n}`);
    Object.assign(s, { status: "completed", ok });
  }
}

/** Chờ tới khi điều kiện đúng (tối đa ms). */
export async function waitFor(cond: () => boolean | Promise<boolean>, ms = 5000, what = "điều kiện") {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`Hết giờ chờ ${what}`);
}

/** Tuỳ chọn Worker cho test: không nghỉ giữa các lần gửi, dò rất nhanh. */
export const FAST = { gapMs: 0, pollMs: 5, loginPollMs: 5, sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, Math.min(ms, 5))) };
