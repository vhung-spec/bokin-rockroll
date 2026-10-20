// MUSE GIẢ (MUSE_FAKE=1) — để xem thử cả quy trình mà không mở Chrome, không tốn lượt Muse: mỗi lệnh "làm xong" sau vài giây
// và trả về một video thử (sọc màu, 10 giây, 1280×720) do ffmpeg tạo. Chỉ dùng phía server.

import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runFfmpeg } from "../ffmpeg";
import type { Attachment, MuseDriver, MuseFile, Quota } from "./page";

export class FakeMuse implements MuseDriver {
  private sessions = new Map<string, { done: number }>();
  private seq = 0;
  private video: Buffer | null = null;

  /** Video thử, tạo một lần. */
  private async clip(): Promise<Buffer> {
    if (this.video) return this.video;
    const dir = mkdtempSync(path.join(/*turbopackIgnore: true*/ os.tmpdir(), "muse-fake-"));
    const out = path.join(/*turbopackIgnore: true*/ dir, "fake.mp4");
    await runFfmpeg(["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=24:duration=10", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", out]);
    this.video = readFileSync(out);
    return this.video;
  }

  async login() {
    return { loggedIn: true };
  }

  async send(_text: string, _atts: Attachment[]) {
    const sessionId = `fake_${++this.seq}`;
    this.sessions.set(sessionId, { done: Date.now() + 5000 });
    return { ok: true, sessionId, reason: "" };
  }

  async status(sid: string) {
    const s = this.sessions.get(sid);
    if (!s) return null;
    return Date.now() < s.done ? "running" : "completed";
  }

  async result(sid: string): Promise<{ files: MuseFile[]; text: string }> {
    const buf = await this.clip();
    return { files: [{ path: `sandbox://fake/${sid}.mp4`, mime: "video/mp4", byteLen: buf.length }], text: "(Muse giả) Đã xong." };
  }

  async readFile() {
    return this.clip();
  }

  async cancel(sid: string) {
    this.sessions.delete(sid);
  }

  async quota(): Promise<Quota | null> {
    return null;
  }

  async show() {}
  async hide() {}
  async close() {}
  onUserClose() {}
}
