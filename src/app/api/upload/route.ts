import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { setReferenceImages } from "@/lib/generate";
import { errorResponse } from "@/lib/http";
import { UPLOAD_DIR, loadMV } from "@/lib/store";

const ALLOWED = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const MAX_BYTES = 10 * 1024 * 1024;

/** Upload ảnh tham chiếu nhân vật (dùng cho image-to-video). Đường dẫn được ghi vào Character Bible. */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const mvId = String(form.get("mvId") ?? "");
    const characterId = String(form.get("characterId") ?? "").replace(/[^A-Z0-9_]/gi, "");
    const mv = await loadMV(mvId);
    if (!mv) return NextResponse.json({ error: "Không tìm thấy MV." }, { status: 404 });
    const character = mv.character_bible.characters.find((c) => c.id === characterId);
    if (!character) return NextResponse.json({ error: "Không có nhân vật này." }, { status: 400 });

    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    if (!files.length) return NextResponse.json({ error: "Chưa chọn ảnh." }, { status: 400 });
    const dir = path.join(UPLOAD_DIR(), mvId);
    await fs.mkdir(dir, { recursive: true });
    const saved: string[] = [];
    for (const file of files) {
      const ext = path.extname(file.name).toLowerCase();
      if (!ALLOWED.has(ext)) return NextResponse.json({ error: `Chỉ nhận ảnh PNG/JPG/WEBP (${file.name}).` }, { status: 400 });
      if (file.size > MAX_BYTES) return NextResponse.json({ error: `Ảnh quá lớn (tối đa 10 MB): ${file.name}` }, { status: 400 });
      const base = path.basename(file.name, ext).replace(/[^a-z0-9_-]+/gi, "-").slice(0, 40) || "ref";
      const name = `${characterId}-${Date.now().toString(36)}-${base}${ext}`;
      await fs.writeFile(path.join(dir, name), Buffer.from(await file.arrayBuffer()));
      saved.push(path.posix.join("data", "uploads", mvId, name));
    }
    const updated = await setReferenceImages(mvId, characterId, [...(character.reference_images ?? []), ...saved]);
    return NextResponse.json(updated);
  } catch (err) {
    return errorResponse(err);
  }
}

/** Xoá một ảnh tham chiếu khỏi nhân vật. */
export async function DELETE(req: Request) {
  try {
    const { mvId, characterId, file } = (await req.json()) as { mvId: string; characterId: string; file: string };
    const mv = await loadMV(mvId);
    if (!mv) return NextResponse.json({ error: "Không tìm thấy MV." }, { status: 404 });
    const character = mv.character_bible.characters.find((c) => c.id === characterId);
    if (!character) return NextResponse.json({ error: "Không có nhân vật này." }, { status: 400 });
    const remaining = (character.reference_images ?? []).filter((p) => p !== file);
    const abs = path.resolve(/*turbopackIgnore: true*/ UPLOAD_DIR(), path.relative(path.join("data", "uploads"), file));
    if (abs.startsWith(path.resolve(/*turbopackIgnore: true*/ UPLOAD_DIR()) + path.sep)) await fs.rm(abs, { force: true });
    return NextResponse.json(await setReferenceImages(mvId, characterId, remaining));
  } catch (err) {
    return errorResponse(err);
  }
}
