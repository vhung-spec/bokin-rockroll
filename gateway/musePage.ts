// MUSE PAGE — script nạp vào trang muse.ai (window.__mss) + lớp gọi nó qua Chrome.
// Gửi lệnh bằng chính client chat của Muse (mỗi lệnh một chat mới), đọc tiến độ qua RPC của Muse (sessions.list / chat.history / chat.cancel),
// tải file kết quả qua fs.raw từng đoạn 2 MB (base64). Chuyển từ engine/muse-page.js của HaoHao.

import type { Chrome } from "./chrome.ts";

export const CHUNK = 2 * 1024 * 1024;

// Chạy TRONG trang Muse (chuỗi JS thuần, không phải mã của cổng). Không dùng template literal bên trong.
const PAGE_MAIN = String.raw`function (CHUNK) {
  const rt = () => window.__hatchEarlyGatewayRuntimeState.activeRuntime.getSnapshot();
  // Object chat của Muse: tìm trong cây React (memoizedProps.value có sendMessage + ensureActiveChatSendReady)
  const chat = () => {
    if (!document.body) return null;
    let root;
    for (const el of [document.body, ...document.querySelectorAll('body *')].slice(0, 80)) {
      const k = Object.keys(el).find(k => k.startsWith('__reactContainer') || k.startsWith('__reactFiber'));
      if (k) { root = el[k]; break; }
    }
    if (!root) return null;
    if (root.stateNode && root.stateNode.current) root = root.stateNode.current;
    const stack = [root];
    for (let n = 0; stack.length && n < 300000; n++) {
      const f = stack.pop();
      const v = f.memoizedProps && f.memoizedProps.value;
      if (v && typeof v.sendMessage === 'function' && typeof v.ensureActiveChatSendReady === 'function') return v;
      if (f.child) stack.push(f.child);
      if (f.sibling) stack.push(f.sibling);
    }
    return null;
  };
  const files = new Map();
  let fileSeq = 0;
  const b64 = u8 => {
    let s = '';
    for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode.apply(null, u8.subarray(i, i + 32768));
    return btoa(s);
  };
  return (window.__mss = {
    async login() {
      try {
        const r = await fetch('/api/session', { credentials: 'include' });
        return { loggedIn: r.status === 200 && Boolean(chat()), http: r.status };
      } catch (e) {
        return { loggedIn: false, http: 0 };
      }
    },
    async send(text, atts) {
      // Trang đang chuyển / đang dựng lại → chờ tối đa 20 s cho client chat hiện lại
      let c = chat();
      for (let k = 0; !c && k < 20; k++) { await new Promise(r => setTimeout(r, 1000)); c = chat(); }
      if (!c) return { ok: false, sessionId: '', reason: 'not_ready (' + location.pathname + ')' };
      const r = await c.sendMessage(text, atts, { createNewThread: true, waitForReadiness: true });
      return { ok: Boolean(r && r.ok), sessionId: (r && r.sessionId) || '', reason: (r && (r.reason || r.error)) || '' };
    },
    async status(sid) {
      const res = await rt().sendRequest('sessions.list', {});
      const s = (res.sessions || []).find(s => s.session_id === sid);
      return s ? s.status : null;
    },
    async result(sid) {
      const h = await rt().sendRequest('chat.history', { session_id: sid, limit: 50 });
      return (h.chat_events || []).filter(e => e.role === 'assistant').map(e => ({
        text: e.display_text || '',
        images: (e.payload && e.payload.data && e.payload.data.images) || [],
        videos: (e.payload && e.payload.data && e.payload.data.videos) || []
      }));
    },
    async open(path) {
      const r = await rt().sendRequest('fs.raw', { path: path.replace(/^sandbox:\/\//, '') });
      const blob = r instanceof Blob ? r : r.data;
      files.set(++fileSeq, blob);
      return { id: fileSeq, size: blob.size };
    },
    async slice(id, i) {
      return b64(new Uint8Array(await files.get(id).slice(i * CHUNK, (i + 1) * CHUNK).arrayBuffer()));
    },
    closeFile(id) {
      files.delete(id);
      return null;
    },
    async cancel(sid) {
      await rt().sendRequest('chat.cancel', { session_id: sid });
      return null;
    },
    // Hạn mức: server action Next.js "fetchSubscriptionAction" (id đổi theo bản Muse → tìm trong các file JS trang đã tải)
    async quota() {
      if (!window.__mssQuotaId) {
        const re = /createServerReference\)\("([0-9a-f]{20,})",[^;]{0,120}?"fetchSubscriptionAction"\)/;
        const urls = [...new Set(performance.getEntriesByType('resource').map(e => e.name).filter(u => /\.js(\?|$)/.test(u)))];
        for (const u of urls) {
          const m = re.exec(await fetch(u).then(r => r.text()).catch(() => ''));
          if (m) { window.__mssQuotaId = m[1]; break; }
        }
        if (!window.__mssQuotaId) return null;
      }
      const r = await fetch('/', {
        method: 'POST', credentials: 'include', body: JSON.stringify([{}]),
        headers: { 'Next-Action': window.__mssQuotaId, Accept: 'text/x-component', 'Content-Type': 'text/plain;charset=UTF-8' }
      });
      if (!r.ok) { window.__mssQuotaId = ''; return null; }
      for (const line of (await r.text()).split('\n')) {
        if (!line.includes('"success"')) continue;
        try {
          const j = JSON.parse(line.slice(line.indexOf(':') + 1));
          if (j.success && j.subscription) return j.subscription;
        } catch (e) {}
      }
      return null;
    }
  });
}`;

export const PAGE_SCRIPT = `(${PAGE_MAIN})(${CHUNK})`;

export interface MuseFile {
  path: string;
  mime: string;
  byteLen: number;
}

export interface Attachment {
  filename: string;
  mimeType: string;
  dataBase64: string;
  category: "image";
}

/** Hạn mức tuần của tài khoản Muse. */
export interface Quota {
  pct: number;
  /** Lúc đặt lại hạn mức (ms). */
  resetsAt: number;
  status: string;
  tier: string;
  paid: boolean;
  label: string;
  subtitle: string;
  checkedAt: number;
}

/** Những gì cổng cần từ trang Muse — Chrome thật (MusePage) hoặc Muse giả khi test. */
export interface MuseDriver {
  login(): Promise<{ loggedIn: boolean }>;
  send(text: string, atts: Attachment[]): Promise<{ ok: boolean; sessionId: string; reason: string }>;
  /** "running" khi Muse đang làm; null khi không thấy phiên. */
  status(sessionId: string): Promise<string | null>;
  result(sessionId: string): Promise<{ files: MuseFile[]; text: string }>;
  readFile(path: string): Promise<Buffer>;
  cancel(sessionId: string): Promise<void>;
  quota(): Promise<Quota | null>;
  show(): Promise<void>;
  hide(): Promise<void>;
  close(): Promise<void>;
  /** Người dùng tự đóng cửa sổ Chrome của cổng (tới khi bấm Đăng nhập lại thì không tự mở Chrome nữa). */
  onUserClose(fn: () => void): void;
}

interface RawEvent {
  text: string;
  images: { path: string; mime: string; byte_len: number; missing?: boolean }[];
  videos: { path: string; mime: string; byte_len: number; missing?: boolean }[];
}

/** Sự kiện trả lời của Muse → file kết quả (video trước ảnh, bỏ file "missing") + lời Muse nói. */
export function parseResult(events: RawEvent[]): { files: MuseFile[]; text: string } {
  const pick = (list: RawEvent["videos"]) => list.filter((m) => !m.missing).map((m) => ({ path: m.path, mime: m.mime, byteLen: m.byte_len }));
  return {
    files: [...pick(events.flatMap((e) => e.videos)), ...pick(events.flatMap((e) => e.images))],
    text: events
      .map((e) => e.text)
      .filter(Boolean)
      .join("\n"),
  };
}

interface RawSubscription {
  usage?: { percentUsed?: number; resetsAt?: number; quotaStatus?: string };
  tier?: { name?: string; isPaid?: boolean };
  usageRowValueLabel?: string;
  statusSubtitle?: string;
}

export function parseQuota(sub: RawSubscription | null, now = Date.now()): Quota | null {
  if (!sub?.usage) return null;
  return {
    pct: Number(sub.usage.percentUsed) || 0,
    resetsAt: (Number(sub.usage.resetsAt) || 0) * 1000,
    status: sub.usage.quotaStatus || "",
    tier: sub.tier?.name || "",
    paid: Boolean(sub.tier?.isPaid),
    label: sub.usageRowValueLabel || "",
    subtitle: sub.statusSubtitle || "",
    checkedAt: now,
  };
}

/** Hết hạn mức tuần (SUFFICIENT / LOW coi là còn). */
export function weeklyOut(q: Quota | null): boolean {
  if (!q) return false;
  return q.pct >= 100 || /EXHAUST|EXCEED|DEPLET|LIMIT|OUT|BLOCK/i.test(q.status);
}

/** Trang Muse thật, chạy trong Chrome của cổng. */
export class MusePage implements MuseDriver {
  chrome: Chrome;

  constructor(chrome: Chrome) {
    this.chrome = chrome;
  }

  private async call(name: string, ...args: unknown[]): Promise<unknown> {
    if (!this.chrome.running) await this.chrome.start();
    // send chờ Muse chuẩn bị máy (waitForReadiness) → cho tới 3 phút
    return this.chrome.evaluate(`(window.__mss || ${PAGE_SCRIPT})[${JSON.stringify(name)}](...${JSON.stringify(args)})`, name === "send" ? 180e3 : undefined);
  }

  async login() {
    return ((await this.call("login")) as { loggedIn: boolean }) ?? { loggedIn: false };
  }

  /** Không thấy khung chat (trang lạ / kẹt) → về trang chủ Muse rồi gửi lại một lần. */
  async send(text: string, atts: Attachment[]) {
    const r = (await this.call("send", text, atts)) as { ok: boolean; sessionId: string; reason: string };
    if (!/^not_ready/.test(r?.reason || "")) return r;
    await this.chrome.cmd("Page.navigate", { url: this.chrome.url }, this.chrome.sessionId);
    return (await this.call("send", text, atts)) as { ok: boolean; sessionId: string; reason: string };
  }

  async status(sid: string) {
    return (await this.call("status", sid)) as string | null;
  }

  async result(sid: string) {
    return parseResult((await this.call("result", sid)) as RawEvent[]);
  }

  async readFile(path: string): Promise<Buffer> {
    const { id, size } = (await this.call("open", path)) as { id: number; size: number };
    try {
      const parts: Buffer[] = [];
      for (let i = 0; i * CHUNK < size; i++) parts.push(Buffer.from((await this.call("slice", id, i)) as string, "base64"));
      return Buffer.concat(parts);
    } finally {
      await this.call("closeFile", id).catch(() => {});
    }
  }

  async cancel(sid: string) {
    await this.call("cancel", sid);
  }

  async quota() {
    return parseQuota((await this.call("quota")) as RawSubscription | null);
  }

  async show() {
    if (!this.chrome.running) await this.chrome.start();
    await this.chrome.show();
  }

  async hide() {
    if (this.chrome.running) await this.chrome.hide();
  }

  close() {
    return this.chrome.close();
  }

  onUserClose(fn: () => void) {
    this.chrome.on("exit", (e: { byUser: boolean }) => {
      if (e.byUser) fn();
    });
  }
}
