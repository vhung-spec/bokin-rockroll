import { NextResponse } from "next/server";
import { UserError } from "@/lib/errors";
import { findFfmpeg } from "@/lib/ffmpeg";
import { errorResponse, readJsonBody } from "@/lib/http";
import { addAsset, addAudio, addClip, loadProject, projectBytes, removeAsset, removeAudio, removeClip, removeRender, setBpm, setOptions, swapClips } from "@/lib/media";
import { getJob, isRendering } from "@/lib/render";
import { zEditOptions } from "@/lib/schemas";
import { loadMV } from "@/lib/store";

type Ctx = { params: Promise<{ id: string }> };

async function mvOr404(id: string) {
  const mv = await loadMV(id);
  if (!mv) throw new UserError("Không tìm thấy MV.", 404);
  return mv;
}

function notWhileRendering(id: string) {
  if (isRendering(id)) throw new UserError("Đang dựng video — chờ xong hoặc huỷ rồi mới đổi nhạc / clip.", 409);
}

function shotParam(mv: Awaited<ReturnType<typeof mvOr404>>, raw: unknown): number {
  const n = Number(raw);
  if (!mv.shots.some((s) => s.shot_no === n)) throw new UserError(`MV không có cảnh #${raw}.`);
  return n;
}

async function state(id: string) {
  const project = await loadProject(id);
  const ff = findFfmpeg();
  return { project, bytes: projectBytes(project), ffmpeg: { ok: ff.ok, version: ff.version, source: ff.source }, job: getJob(id) };
}

/** Trạng thái dựng video của MV: nhạc, clip, tuỳ chọn, các bản đã dựng, ffmpeg, tiến độ. */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    await mvOr404(id);
    return NextResponse.json(await state(id));
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * Tải lên một file (thân request là nội dung file):
 * ?kind=audio&name=bai-hat.mp3 · ?kind=clip&shot=3&name=shot-03.mp4 · ?kind=logo&name=logo.png · ?kind=font&name=font.ttf
 */
export async function PUT(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const mv = await mvOr404(id);
    notWhileRendering(id);
    const url = new URL(req.url);
    const kind = url.searchParams.get("kind");
    const name = (url.searchParams.get("name") ?? "").slice(0, 200);
    if (!req.body) throw new UserError("Chưa có nội dung file.");
    if (kind === "audio") await addAudio(id, name, req.body);
    else if (kind === "clip") await addClip(id, shotParam(mv, url.searchParams.get("shot")), name, req.body);
    else if (kind === "logo" || kind === "font") await addAsset(id, kind, name, req.body);
    else throw new UserError("kind phải là audio, clip, logo hoặc font.");
    return NextResponse.json(await state(id));
  } catch (err) {
    return errorResponse(err);
  }
}

/** Xoá nhạc (?kind=audio), clip của một cảnh (?kind=clip&shot=3), logo / font (?kind=logo|font) hoặc một bản đã dựng (?kind=render&file=…). */
export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const mv = await mvOr404(id);
    const url = new URL(req.url);
    const kind = url.searchParams.get("kind");
    if (kind === "render") await removeRender(id, url.searchParams.get("file") ?? "");
    else {
      notWhileRendering(id);
      if (kind === "audio") await removeAudio(id);
      else if (kind === "clip") await removeClip(id, shotParam(mv, url.searchParams.get("shot")));
      else if (kind === "logo" || kind === "font") await removeAsset(id, kind);
      else throw new UserError("kind không hợp lệ.");
    }
    return NextResponse.json(await state(id));
  } catch (err) {
    return errorResponse(err);
  }
}

/** { action: "swap", a, b } | { action: "options", options } | { action: "bpm", bpm: number | null } */
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const mv = await mvOr404(id);
    const body = await readJsonBody<{ action: string; a?: number; b?: number; options?: unknown; bpm?: number | null }>(req);
    switch (body.action) {
      case "swap":
        notWhileRendering(id);
        await swapClips(id, shotParam(mv, body.a), shotParam(mv, body.b));
        break;
      case "options":
        await setOptions(id, zEditOptions.parse(body.options));
        break;
      case "bpm": {
        const bpm = body.bpm === null || body.bpm === undefined ? null : Number(body.bpm);
        if (bpm !== null && !(bpm >= 40 && bpm <= 260)) throw new UserError("BPM phải trong khoảng 40–260.");
        await setBpm(id, bpm);
        break;
      }
      default:
        throw new UserError("action không hợp lệ.");
    }
    return NextResponse.json(await state(id));
  } catch (err) {
    return errorResponse(err);
  }
}
