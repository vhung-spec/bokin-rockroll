import { promises as fs } from "node:fs";
import path from "node:path";
import { UPLOAD_DIR } from "@/lib/store";

const TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

/** Phục vụ ảnh tham chiếu đã upload (chỉ trong thư mục data/uploads). */
export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const parts = (await params).path;
  const root = path.resolve(/*turbopackIgnore: true*/ UPLOAD_DIR());
  const file = path.resolve(/*turbopackIgnore: true*/ root, ...parts);
  const type = TYPES[path.extname(file).toLowerCase()];
  if (!file.startsWith(root + path.sep) || !type) return new Response("Not found", { status: 404 });
  try {
    const data = await fs.readFile(file);
    return new Response(new Uint8Array(data), { headers: { "Content-Type": type, "Cache-Control": "private, max-age=3600" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
