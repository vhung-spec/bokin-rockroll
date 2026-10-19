import { NextResponse } from "next/server";
import { UserError } from "@/lib/errors";
import { errorResponse, readJsonBody } from "@/lib/http";
import { loadProject } from "@/lib/media";
import { addToQueue, cancelCurrent, clearFinished, pauseQueue, readQueue, removeFromQueue, retryItem, startQueue } from "@/lib/queue";
import { listMVs } from "@/lib/store";

/** MV nào đã đủ nhạc + clip để dựng. */
async function candidates() {
  const mvs = await listMVs();
  return Promise.all(
    mvs.map(async (mv) => {
      const p = await loadProject(mv.id).catch(() => null);
      const clips = p ? mv.shots.filter((s) => p.clips[String(s.shot_no)]).length : 0;
      return {
        id: mv.id,
        idea_id: mv.idea.id,
        title: mv.idea.song_title || mv.idea.world_location,
        series: mv.idea.series ?? "",
        created_at: mv.created_at,
        shot_count: mv.shots.length,
        clip_count: clips,
        audio: p?.audio ? { name: p.audio.name, duration: p.audio.duration } : null,
        last_render: p?.renders[0] ? { file: p.renders[0].file, created_at: p.renders[0].created_at, size: p.renders[0].size } : null,
      };
    }),
  );
}

export async function GET() {
  try {
    const [queue, mvs] = await Promise.all([readQueue(), candidates()]);
    return NextResponse.json({ queue, mvs });
  } catch (err) {
    return errorResponse(err);
  }
}

/** { action: "add", ids, start? } | { action: "remove" | "retry", id } | { action: "start" | "pause" | "cancel" | "clear" } */
export async function POST(req: Request) {
  try {
    const body = await readJsonBody<{ action: string; ids?: unknown; id?: unknown; start?: boolean }>(req);
    switch (body.action) {
      case "add": {
        const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string") : [];
        if (!ids.length) throw new UserError("Chưa chọn MV nào.");
        const added = await addToQueue(ids);
        if (body.start) await startQueue();
        return NextResponse.json({ added, queue: await readQueue() });
      }
      case "remove":
        await removeFromQueue(String(body.id ?? ""));
        break;
      case "retry":
        await retryItem(String(body.id ?? ""));
        break;
      case "start":
        await startQueue();
        break;
      case "pause":
        await pauseQueue();
        break;
      case "cancel":
        await cancelCurrent();
        break;
      case "clear":
        await clearFinished();
        break;
      default:
        throw new UserError("action không hợp lệ.");
    }
    return NextResponse.json({ queue: await readQueue() });
  } catch (err) {
    return errorResponse(err);
  }
}
