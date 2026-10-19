import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { mediaPath } from "@/lib/media";

const TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".png": "image/png",
};

type Ctx = { params: Promise<{ id: string; file: string }> };

/** Phát nhạc / clip / video đã dựng (hỗ trợ tua — HTTP Range). ?download=1 để tải về. */
export async function GET(req: Request, { params }: Ctx) {
  const { id, file } = await params;
  let abs: string;
  try {
    abs = mediaPath(id, file);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const type = TYPES[path.extname(file).toLowerCase()];
  if (!type || file === "project.json") return new Response("Not found", { status: 404 });
  let size: number;
  try {
    const st = await fs.stat(abs);
    if (!st.isFile()) throw new Error();
    size = st.size;
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const headers: Record<string, string> = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600" };
  if (new URL(req.url).searchParams.get("download")) headers["Content-Disposition"] = `attachment; filename="${file}"`;

  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    end = Math.min(end, size - 1);
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    start = Math.max(0, start);
    const stream = Readable.toWeb(createReadStream(abs, { start, end })) as ReadableStream<Uint8Array>;
    return new Response(stream, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  const stream = Readable.toWeb(createReadStream(abs)) as ReadableStream<Uint8Array>;
  return new Response(stream, { headers: { ...headers, "Content-Length": String(size) } });
}
