// Tiện ích phía trình duyệt: gọi API, copy clipboard.

export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json", ...(rest.headers ?? {}) } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error ?? `Lỗi ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export function exportUrl(format: string, opts: { ids?: string[]; series?: string }): string {
  const p = new URLSearchParams({ format });
  if (opts.ids) p.set("ids", opts.ids.join(","));
  if (opts.series !== undefined) p.set("series", opts.series);
  return `/api/export?${p.toString()}`;
}

export const lines = (s: string) =>
  s
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);

/** Tải một file lên (thân request là nội dung file), có báo tiến độ 0–1. */
export function uploadFile<T>(url: string, file: File, onProgress?: (fraction: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      let data: unknown = null;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        data = { error: xhr.responseText };
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else reject(new Error((data as { error?: string } | null)?.error ?? `Lỗi ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("Mất kết nối khi tải file lên."));
    xhr.send(file);
  });
}

export const mediaUrl = (mvId: string, file: string, download = false) =>
  `/api/media/${encodeURIComponent(mvId)}/${encodeURIComponent(file)}${download ? "?download=1" : ""}`;

export function formatBytes(n: number): string {
  if (n < 1024 ** 2) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1).replace(".", ",")} MB`;
  return `${(n / 1024 ** 3).toFixed(2).replace(".", ",")} GB`;
}

/** 83.4 → "1:23.4" */
export function formatClock(t: number, decimals = 1): string {
  t = Math.round(Math.max(0, t) * 10 ** decimals) / 10 ** decimals;
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  const str = s.toFixed(decimals).padStart(decimals ? 3 + decimals : 2, "0");
  return `${m}:${str}`;
}

/** "1:23.4" hoặc "83.4" → 83.4 (null nếu không hợp lệ). */
export function parseClock(text: string): number | null {
  const m = /^\s*(?:(\d+):)?(\d+(?:[.,]\d+)?)\s*$/.exec(text);
  if (!m) return null;
  return (m[1] ? Number(m[1]) * 60 : 0) + Number(m[2].replace(",", "."));
}

/** Mọi file trong lần kéo thả, kể cả file nằm trong thư mục (và thư mục con) được thả vào. */
export async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const entries = [...dt.items]
    .map((it) => (it.kind === "file" ? it.webkitGetAsEntry?.() : null))
    .filter((e): e is FileSystemEntry => Boolean(e));
  if (!entries.length || entries.every((e) => e.isFile)) return [...dt.files];
  const out: File[] = [];
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      out.push(await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej)));
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // readEntries trả về từng đợt (tối đa ~100 mục) cho tới khi hết.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const e of batch) await walk(e);
      }
    }
  };
  for (const e of entries) await walk(e);
  return out;
}
