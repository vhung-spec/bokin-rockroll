// DÂY CHUYỀN TỰ ĐỘNG — mỗi việc là một MV (có sẵn, hoặc viết từ một dòng ý tưởng) chạy qua 4 bước:
//   1. Kịch bản: Claude viết (cần API key; chế độ Demo cũng chạy được) — làm lần lượt từng MV.
//   2. Bài hát: MV chưa có bài → tìm file trùng tên bài trong Thư mục nhạc (Cài đặt) và đưa vào MV.
//   3. Clip: gửi các cảnh chưa có clip sang Muse (Muse trong app), clip xong tự vào đúng cảnh (museJobs).
//   4. Dựng: đủ clip + có bài hát → thêm vào hàng chờ dựng, chạy, chờ ra MP4.
// Lưu ở data/pipeline.json; tắt app giữa chừng thì mở lại chạy tiếp. Chỉ dùng phía server.

import { createReadStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { UserError } from "./errors";
import { probe } from "./ffmpeg";
import { generateMV, generationMode } from "./generate";
import { addAudio, loadProject } from "./media";
import { museCounts } from "./muse";
import { ensureMuseWatch, readMuse, sendToMuse } from "./museJobs";
import { addToQueue, readQueue, startQueue } from "./queue";
import { isRendering } from "./render";
import { findSong } from "./songs";
import type { PipelineItem, PipelineState, PipelineStep, PipelineView, StepName } from "./pipelineSteps";
import { PIPELINE_FILE, loadMV, readJson, readSettings, withLock, writeJson } from "./store";
import type { IdeaRow } from "./types";

const POLL_MS = 5000;
const IDLE_MS = 30000;

// Trạng thái trong tiến trình: vòng chạy, việc đang viết kịch bản (mỗi lúc một MV), hàm đánh thức vòng chạy đang nghỉ.
const g = globalThis as unknown as {
  __mvPipeline?: { loop: Promise<void> | null; again: boolean; wake: (() => void) | null; generating: string | null; error: string | null };
};
const mem = (g.__mvPipeline ??= { loop: null, again: false, wake: null, generating: null, error: null });

export function readPipeline(): Promise<PipelineState> {
  return readJson<PipelineState>(PIPELINE_FILE(), { items: [] });
}

function updatePipeline<T>(fn: (s: PipelineState) => T | Promise<T>): Promise<T> {
  return withLock("pipeline", async () => {
    const s = await readPipeline();
    const result = await fn(s);
    await writeJson(PIPELINE_FILE(), s);
    return result;
  });
}

const newId = () => `pl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const fresh = (): Record<StepName, PipelineStep> => ({ script: { status: "pending" }, song: { status: "pending" }, clips: { status: "pending" }, render: { status: "pending" } });
const finished = (it: PipelineItem) => Boolean(it.done_at);

/** Thêm việc: MV có sẵn và / hoặc ý tưởng mới. MV đang chạy dở trong dây chuyền thì bỏ qua. */
export async function addToPipeline(input: { mvIds?: string[]; ideas?: IdeaRow[] }): Promise<number> {
  const mvIds = input.mvIds ?? [];
  const ideas = input.ideas ?? [];
  if (!mvIds.length && !ideas.length) throw new UserError("Chưa chọn MV hay ý tưởng nào.");
  const settings = await readSettings();
  if (ideas.length && generationMode(settings) === "manual") {
    throw new UserError("Tự viết kịch bản cần Claude API key: vào Cài đặt → “API key của Claude” (hoặc chọn chế độ Demo để thử). Ở chế độ claude.ai thì viết kịch bản như hiện nay rồi chọn MV có sẵn.");
  }
  const now = new Date().toISOString();
  const items: PipelineItem[] = [];
  for (const id of mvIds) {
    const mv = await loadMV(id);
    if (!mv) throw new UserError(`Không tìm thấy MV ${id}.`, 404);
    items.push({ id: newId(), title: mv.idea.song_title || mv.idea.world_location, added_at: now, mv_id: id, steps: { ...fresh(), script: { status: "done", message: `${mv.shots.length} cảnh (có sẵn)` } } });
  }
  for (const idea of ideas) items.push({ id: newId(), title: idea.song_title || idea.world_location, added_at: now, idea, steps: fresh() });
  const added = await updatePipeline((st) => {
    const busy = new Set(st.items.filter((i) => !finished(i) && i.mv_id).map((i) => i.mv_id));
    const take = items.filter((i) => !i.mv_id || !busy.has(i.mv_id));
    st.items.unshift(...take);
    return take.length;
  });
  ensurePipelineWatch();
  return added;
}

export function removeFromPipeline(id: string): Promise<void> {
  return updatePipeline((st) => {
    st.items = st.items.filter((i) => i.id !== id);
  });
}

export function clearFinishedPipeline(): Promise<void> {
  return updatePipeline((st) => {
    st.items = st.items.filter((i) => !finished(i));
  });
}

/** Chạy lại các bước lỗi của một việc (bước dựng: dựng lại; bước clip: gửi lại các cảnh còn thiếu clip — tốn lượt). */
export async function retryPipeline(id: string): Promise<void> {
  await updatePipeline((st) => {
    const it = st.items.find((i) => i.id === id);
    if (!it) return;
    for (const name of Object.keys(it.steps) as StepName[]) {
      if (it.steps[name].status !== "error") continue;
      it.steps[name] = { status: "pending" };
      if (name === "clips") it.clips_sent = false;
      if (name === "render") it.render_at = undefined;
    }
  });
  ensurePipelineWatch();
}

/** Viết kịch bản cho một việc (chạy nền, mỗi lúc một MV). Có bài hát trong Thư mục nhạc → lấy luôn độ dài bài. */
function startScript(item: PipelineItem, songDir: string) {
  mem.generating = item.id;
  void (async () => {
    try {
      const idea = { ...item.idea! };
      if (!idea.duration_sec) {
        const song = await findSong(songDir, idea.song_title).catch(() => null);
        if (song) {
          const d = (await probe(song.file).catch(() => null))?.duration;
          if (d && d >= 10) idea.duration_sec = Math.min(1200, Math.round(d));
        }
      }
      const mv = await generateMV(idea);
      await patch(item.id, (it) => {
        it.mv_id = mv.id;
        it.steps.script = { status: "done", message: `${mv.shots.length} cảnh` };
      });
    } catch (err) {
      await patch(item.id, (it) => {
        it.steps.script = { status: "error", message: (err as Error).message };
      });
    } finally {
      mem.generating = null;
      ensurePipelineWatch();
    }
  })();
}

function patch(id: string, fn: (it: PipelineItem) => void): Promise<void> {
  return updatePipeline((st) => {
    const it = st.items.find((i) => i.id === id);
    if (it) fn(it);
  });
}

/** Một bước của một việc → trạng thái mới (đọc MV, bài hát, tiến độ Muse, hàng chờ dựng). */
async function advance(item: PipelineItem): Promise<Partial<PipelineItem> | null> {
  const settings = await readSettings();
  const steps = { ...item.steps };
  const out: Partial<PipelineItem> = {};

  // 1. Kịch bản
  if (!item.mv_id) {
    if (steps.script.status === "error") return null;
    if (generationMode(settings) === "manual") {
      steps.script = { status: "error", message: "Cần Claude API key để tự viết kịch bản (Cài đặt → API key của Claude)." };
    } else if (!mem.generating) {
      startScript(item, settings.songDir);
      steps.script = { status: "running", message: "Claude đang viết kịch bản…" };
    } else if (mem.generating !== item.id) {
      steps.script = { status: "waiting", message: "Chờ tới lượt viết kịch bản" };
    }
    return { steps };
  }
  const mv = await loadMV(item.mv_id);
  if (!mv) return { steps: { ...steps, script: { status: "error", message: "MV đã bị xoá." } } };
  const project = await loadProject(mv.id);

  // 2. Bài hát
  if (project.audio) {
    if (steps.song.status !== "done") steps.song = { status: "done", message: project.audio.name };
  } else if (!settings.songDir.trim()) {
    steps.song = { status: "waiting", message: "Chưa có bài hát — tải lên ở trang Ghép video, hoặc đặt “Thư mục nhạc” trong Cài đặt để app tự tìm." };
  } else if (!isRendering(mv.id)) {
    const title = mv.idea.song_title || item.title;
    try {
      const song = await findSong(settings.songDir, title);
      if (!song) {
        steps.song = { status: "waiting", message: `Chưa thấy bài “${title}” trong thư mục nhạc — thêm file vào thư mục, hoặc tải lên ở trang Ghép video.` };
      } else {
        const name = path.basename(song.file);
        await addAudio(mv.id, name, Readable.toWeb(createReadStream(song.file)) as ReadableStream<Uint8Array>);
        steps.song = { status: "done", message: `Tự ghép: ${name}${song.ties ? ` (có ${song.ties + 1} file trùng tên, đã chọn file này)` : ""}` };
      }
    } catch (err) {
      steps.song = { status: "error", message: (err as Error).message };
    }
  }

  // 3. Clip Muse
  const missing = mv.shots.filter((s) => !project.clips[String(s.shot_no)]).length;
  if (!missing) {
    steps.clips = { status: "done", message: `Đủ ${mv.shots.length} clip` };
  } else if (settings.museMode !== "gateway") {
    steps.clips = { status: "waiting", message: `Thiếu ${missing} clip — đang dùng cách dán tay vào HaoHao: vào trang Clip Muse để copy prompt.` };
  } else if (steps.clips.status !== "error") {
    if (!item.clips_sent) {
      try {
        const r = await sendToMuse([mv.id], { onlyMissing: true });
        out.clips_sent = true;
        steps.clips = { status: "running", message: `Đã gửi ${r.count} cảnh sang Muse${r.reused ? `, nhận lại ${r.reused} video có sẵn` : ""}` };
      } catch (err) {
        // Các cảnh thiếu clip đều đang được Muse làm → coi như đã gửi.
        if (/đang được Muse làm/.test((err as Error).message)) out.clips_sent = true;
        else steps.clips = { status: "error", message: (err as Error).message };
      }
    } else {
      const m = (await readMuse()).mvs.find((x) => x.mv_id === mv.id);
      const c = m ? museCounts(m) : null;
      if (c && c.error && !c.active && !c.waiting) {
        steps.clips = { status: "error", message: `${c.error} cảnh lỗi — vào trang Clip Muse để “Kiểm tra lại” (không tốn lượt) hoặc “Gửi lại”.` };
      } else {
        steps.clips = { status: "running", message: `${mv.shots.length - missing}/${mv.shots.length} cảnh có clip${c?.error ? ` · ${c.error} lỗi` : ""}` };
      }
      ensureMuseWatch(false);
    }
  }

  // 4. Dựng
  if (steps.song.status === "done" && steps.clips.status === "done" && steps.render.status !== "error") {
    const queue = await readQueue();
    const q = queue.items.filter((i) => i.mv_id === mv.id && i.added_at >= item.added_at).sort((a, b) => b.added_at.localeCompare(a.added_at))[0];
    if (!item.render_at && !q) {
      await addToQueue([mv.id]);
      await startQueue();
      out.render_at = new Date().toISOString();
      steps.render = { status: "running", message: "Đã thêm vào hàng chờ dựng" };
    } else if (!q || q.status === "waiting") {
      out.render_at ??= item.render_at ?? new Date().toISOString();
      if (q && !queue.running) await startQueue();
      steps.render = { status: "running", message: "Đang chờ tới lượt dựng" };
    } else if (q.status === "running") {
      steps.render = { status: "running", message: "Đang dựng MP4…" };
    } else if (q.status === "done") {
      steps.render = { status: "done", message: q.output };
      out.output = q.output;
      out.done_at = new Date().toISOString();
    } else {
      steps.render = { status: "error", message: q.message || "Dựng không thành công." };
    }
  }
  return { ...out, steps };
}

/** Một lượt chạy: đẩy từng việc chưa xong qua bước kế tiếp. Trả về nhịp chạy tiếp (null = không còn gì để chạy). */
export function pipelineTick(): Promise<"fast" | "slow" | null> {
  return withLock("pipeline-tick", async () => {
    const state = await readPipeline();
    for (const item of state.items.filter((i) => !finished(i))) {
      try {
        const next = await advance(item);
        if (next) await patch(item.id, (it) => Object.assign(it, next, { steps: { ...it.steps, ...next.steps } }));
      } catch (err) {
        mem.error = (err as Error).message;
      }
    }
    const open = (await readPipeline()).items.filter((i) => !finished(i));
    const active = open.some((i) => Object.values(i.steps).some((s) => s.status === "running" || s.status === "pending"));
    if (active || mem.generating) return "fast";
    // Chỉ còn việc chờ bài hát / chờ người dùng xử lý lỗi → dò thưa.
    return open.some((i) => Object.values(i.steps).some((s) => s.status === "waiting")) ? "slow" : null;
  });
}

/** Bật vòng chạy nền (nếu chưa chạy). `wake` = đang nghỉ thì chạy ngay. */
export function ensurePipelineWatch(wake = true): void {
  if (process.env.PIPELINE_NO_WATCH) return; // test tự gọi pipelineTick từng lượt
  if (mem.loop) {
    if (wake) {
      mem.again = true;
      mem.wake?.();
    }
    return;
  }
  mem.loop = (async () => {
    try {
      for (;;) {
        mem.again = false;
        const pace = await pipelineTick().catch((err) => {
          console.error("[pipeline]", err);
          mem.error = (err as Error).message;
          return "fast" as const;
        });
        if (!pace && !mem.again) return;
        if (mem.again) continue;
        await new Promise<void>((r) => {
          const t = setTimeout(r, pace === "slow" ? IDLE_MS : POLL_MS);
          mem.wake = () => {
            clearTimeout(t);
            r();
          };
        });
        mem.wake = null;
      }
    } finally {
      mem.loop = null;
      mem.wake = null;
    }
  })();
}

export async function pipelineView(): Promise<PipelineView> {
  const state = await readPipeline();
  if (state.items.some((i) => !finished(i))) ensurePipelineWatch(false);
  return { items: state.items, error: mem.error, generating: mem.generating };
}

/** Chờ việc viết kịch bản đang chạy xong (dùng cho test). */
export async function pipelineIdle(): Promise<void> {
  while (mem.generating) await new Promise((r) => setTimeout(r, 20));
}
