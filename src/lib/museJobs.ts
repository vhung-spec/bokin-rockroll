// Tạo clip bằng Muse qua HaoHao — phía server: lưu các cảnh đang làm (data/muse.json), dò HaoHao vài giây một lần,
// clip nào xong thì đưa vào đúng cảnh của đúng MV, MV đủ clip + có bài hát thì tự vào hàng chờ dựng.
// Tắt app giữa chừng: HaoHao vẫn làm tiếp; mở lại app là dò tiếp từ data/muse.json.

import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { UserError } from "./errors";
import { defaultHaoHaoDir, haohaoDir, haohaoInfo, haohaoSource, type HaoHaoInfo } from "./haohao";
import { VIDEO_EXT, addClip, loadProject } from "./media";
import {
  advanceJob,
  finishedTask,
  isFinal,
  museText,
  pasteText,
  pickTask,
  type MuseMV,
  type MuseShotJob,
  type MuseSource,
  type MuseState,
  type MuseTask,
} from "./muse";
import { addToQueue, startQueue } from "./queue";
import { isRendering } from "./render";
import { MUSE_FILE, loadMV, readJson, readSettings, withLock, writeJson } from "./store";
import type { Settings } from "./types";

/** Dò HaoHao mỗi 4 giây khi còn cảnh đang làm; chỉ còn MV chờ bài hát (để tự dựng) thì 30 giây. */
const POLL_MS = 4000;
const IDLE_MS = 30000;

// Trạng thái trong tiến trình: vòng dò hiện tại, có yêu cầu dò lại trong lúc vòng cũ sắp dừng, lỗi đọc HaoHao gần nhất.
const g = globalThis as unknown as { __mvMuse?: { loop: Promise<void> | null; again: boolean; error: string | null } };
const mem = (g.__mvMuse ??= { loop: null, again: false, error: null });

export function readMuse(): Promise<MuseState> {
  return readJson<MuseState>(MUSE_FILE(), { mvs: [] });
}

function updateMuse<T>(fn: (s: MuseState) => T | Promise<T>): Promise<T> {
  return withLock("muse", async () => {
    const s = await readMuse();
    const result = await fn(s);
    await writeJson(MUSE_FILE(), s);
    return result;
  });
}

/** Nguồn task: hiện là đọc file của HaoHao bản cho khách. Bản HaoHao có API → thêm nguồn mới ở đây. */
function sourceFor(settings: Settings): MuseSource {
  return haohaoSource(haohaoDir(settings.museDataDir));
}

const findJob = (s: MuseState, mvId: string, shotNo: number) => s.mvs.find((m) => m.mv_id === mvId)?.shots.find((j) => j.shot_no === shotNo);

// ---------- Gửi cảnh sang Muse ----------

export interface SendResult {
  /** Nội dung để dán vào tab Studio của HaoHao (mỗi prompt cách nhau một dòng trống). */
  text: string;
  /** Số prompt cần dán (= số lượt Muse sẽ dùng). */
  count: number;
  /** Số cảnh nhận luôn clip đã có sẵn bên HaoHao (cùng prompt), không tốn thêm lượt. */
  reused: number;
  shots: number;
  mvs: number;
  warning?: string;
}

/**
 * Bắt đầu tạo clip cho các MV: ghi nhận từng cảnh, trả về chữ để dán vào HaoHao.
 * `shots` (khi gửi một MV) = chỉ các cảnh này; `onlyMissing` = chỉ cảnh chưa có clip.
 * Cảnh chưa có clip mà HaoHao đã có sẵn video cùng prompt → nhận luôn video đó, không dán lại.
 */
export async function sendToMuse(ids: string[], opts: { shots?: number[]; onlyMissing?: boolean } = {}): Promise<SendResult> {
  if (!ids.length) throw new UserError("Chưa chọn MV nào.");
  const settings = await readSettings();
  let tasks: MuseTask[] = [];
  let warning: string | undefined;
  try {
    tasks = await sourceFor(settings).tasks();
  } catch (err) {
    warning = (err as Error).message;
  }
  const now = new Date().toISOString();
  const texts = new Set<string>();
  const planned: MuseMV[] = [];
  const state = await readMuse();
  let reused = 0;
  for (const id of ids) {
    const mv = await loadMV(id);
    if (!mv) throw new UserError(`Không tìm thấy MV ${id}.`, 404);
    const project = await loadProject(id);
    // Không chỉ rõ cảnh → bỏ qua cảnh đang chờ dán / đang làm (tránh dán hai lần, tốn hai lượt).
    const open = new Set(
      (state.mvs.find((m) => m.mv_id === id)?.shots ?? []).filter((j) => !isFinal(j.status) && j.status !== "error").map((j) => j.shot_no),
    );
    const chosen = mv.shots.filter((s) =>
      opts.shots ? opts.shots.includes(s.shot_no) : !open.has(s.shot_no) && (!opts.onlyMissing || !project.clips[String(s.shot_no)]),
    );
    if (!chosen.length) continue;
    const jobs = chosen.map((s): MuseShotJob => {
      const text = museText(s, { avoid: settings.museAvoid });
      const replaces = project.clips[String(s.shot_no)]?.file ?? null;
      const ready = replaces ? undefined : finishedTask(text, tasks, existsSync);
      if (ready) {
        reused++;
        return { shot_no: s.shot_no, text, sent_at: new Date(ready.created_at - 1000).toISOString(), status: "queued", step: "Đã có sẵn bên HaoHao — đang nhận", replaces };
      }
      // Hai cảnh trùng nội dung thì chỉ dán một lần — cả hai nhận cùng một clip.
      texts.add(text);
      return { shot_no: s.shot_no, text, sent_at: now, status: "waiting", replaces };
    });
    planned.push({ mv_id: id, title: mv.idea.song_title || mv.idea.world_location, added_at: now, shots: jobs });
  }
  if (!planned.length) {
    throw new UserError(opts.onlyMissing ? "Không có cảnh nào cần tạo: các cảnh chưa có clip đều đang được Muse làm (hoặc MV đã đủ clip)." : "Không có cảnh nào được chọn.");
  }

  await updateMuse((st) => {
    for (const p of planned) {
      const cur = st.mvs.find((m) => m.mv_id === p.mv_id);
      if (!cur) {
        st.mvs.unshift(p);
        continue;
      }
      // Gửi lại cảnh đã có → thay bản theo dõi cũ của cảnh đó; MV có clip mới thì được tự dựng lại.
      const nos = new Set(p.shots.map((s) => s.shot_no));
      cur.shots = [...cur.shots.filter((s) => !nos.has(s.shot_no)), ...p.shots].sort((a, b) => a.shot_no - b.shot_no);
      Object.assign(cur, { title: p.title, queued_at: undefined, note: undefined });
    }
  });
  ensureMuseWatch();
  return { text: pasteText([...texts]), count: texts.size, reused, shots: planned.reduce((n, p) => n + p.shots.length, 0), mvs: planned.length, warning };
}

/** Thôi theo dõi các cảnh (hoặc cả MV) — không đụng tới clip đã có, không đụng tới HaoHao. */
export function forgetMuse(mvId: string, shots?: number[]): Promise<void> {
  return updateMuse((st) => {
    const mv = st.mvs.find((m) => m.mv_id === mvId);
    if (!mv) return;
    mv.shots = shots ? mv.shots.filter((s) => !shots.includes(s.shot_no)) : [];
    st.mvs = st.mvs.filter((m) => m.shots.length);
  });
}

// ---------- Dò HaoHao, nhận clip, tự dựng ----------

/** Đưa clip của task đã xong vào cảnh. Trả về phần cập nhật của cảnh. */
async function importClip(mvId: string, job: MuseShotJob, task: MuseTask): Promise<Partial<MuseShotJob>> {
  // Đang dựng MV này → để lượt dò sau.
  if (isRendering(mvId)) return { status: "running", step: "Chờ dựng xong để đưa clip vào" };
  const fail = (message: string): Partial<MuseShotJob> => ({ status: "error", step: undefined, message, import_error_task: task.id });
  const file = task.files.find((f) => VIDEO_EXT.includes(path.extname(f).toLowerCase()) && existsSync(f));
  if (!file) return fail("HaoHao báo xong nhưng không thấy file video (đã bị xoá hoặc chuyển chỗ?). Chạy lại task trong HaoHao hoặc gửi lại cảnh này.");
  const current = (await loadProject(mvId)).clips[String(job.shot_no)]?.file ?? null;
  if (current && current !== job.replaces && current !== job.clip_file) {
    return { status: "kept", step: undefined, message: "Cảnh đã có clip bạn tự thêm sau khi gửi — giữ nguyên, không đè. Muốn dùng clip Muse thì xoá clip đó rồi gửi lại cảnh." };
  }
  try {
    const body = Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>;
    const project = await addClip(mvId, job.shot_no, path.basename(file), body);
    return { status: "done", step: undefined, clip_file: project.clips[String(job.shot_no)]?.file, done_at: new Date().toISOString() };
  } catch (err) {
    return fail(`Không đưa được clip vào MV: ${(err as Error).message}`);
  }
}

export interface TickDeps {
  /** Thêm MV vào hàng chờ dựng và chạy (đổi được khi test). */
  enqueue?: (mvIds: string[]) => Promise<void>;
}

const defaultEnqueue = async (mvIds: string[]) => {
  await addToQueue(mvIds);
  await startQueue();
};

/** MV đã xong phần Muse (mọi cảnh xong, có ít nhất một clip mới) nhưng chưa tự dựng. */
const awaitingRender = (mv: MuseMV) => !mv.queued_at && mv.shots.length > 0 && mv.shots.every((s) => isFinal(s.status)) && mv.shots.some((s) => s.status === "done");

/**
 * Một lượt dò: cập nhật trạng thái từ HaoHao, đưa clip đã xong vào MV, tự thêm MV đủ clip + có nhạc vào hàng chờ dựng.
 * Trả về nhịp dò tiếp: "fast" (còn cảnh đang làm), "slow" (chỉ còn MV chờ bài hát), null (không cần dò nữa).
 */
export function museTick(deps: TickDeps = {}): Promise<"fast" | "slow" | null> {
  return withLock("muse-tick", async () => {
    const settings = await readSettings();
    let state = await readMuse();

    // MV đã bị xoá → thôi theo dõi.
    const exists = await Promise.all(state.mvs.map((m) => loadMV(m.mv_id).then(Boolean, () => false)));
    const gone = state.mvs.filter((_, i) => !exists[i]).map((m) => m.mv_id);
    if (gone.length) {
      state = await updateMuse((st) => {
        st.mvs = st.mvs.filter((m) => !gone.includes(m.mv_id));
        return st;
      });
    }

    if (state.mvs.some((m) => m.shots.some((s) => !isFinal(s.status)))) {
      let tasks: MuseTask[] | null = null;
      try {
        tasks = await sourceFor(settings).tasks();
        mem.error = null;
      } catch (err) {
        mem.error = (err as Error).message;
      }
      if (tasks) {
        const found = tasks;
        const imports = await updateMuse((st) => {
          const out: { mvId: string; job: MuseShotJob; task: MuseTask }[] = [];
          for (const mv of st.mvs) {
            mv.shots = mv.shots.map((job) => {
              const r = advanceJob(job, pickTask(job, found));
              if (r.importNow) out.push({ mvId: mv.mv_id, job: r.job, task: r.importNow });
              return r.job;
            });
          }
          return out;
        });
        // Chép clip ngoài khoá (file có thể lớn); cảnh bị gửi lại trong lúc chép thì bỏ kết quả cũ.
        for (const { mvId, job, task } of imports) {
          const patch = await importClip(mvId, job, task);
          await updateMuse((st) => {
            const cur = findJob(st, mvId, job.shot_no);
            if (cur && cur.sent_at === job.sent_at && !isFinal(cur.status)) Object.assign(cur, patch);
          });
        }
      }
    }

    // Tự dựng: MV đủ clip cho mọi cảnh + có bài hát.
    state = await readMuse();
    if (settings.museAutoRender) {
      for (const mv of state.mvs.filter(awaitingRender)) {
        const full = await loadMV(mv.mv_id);
        if (!full) continue;
        const project = await loadProject(mv.mv_id);
        const missing = full.shots.filter((s) => !project.clips[String(s.shot_no)]).length;
        let note = !project.audio
          ? "Đủ clip — thêm bài hát là app tự đưa MV vào hàng chờ dựng."
          : missing
            ? `Còn ${missing} cảnh chưa có clip — chưa tự dựng.`
            : null;
        let queuedAt: string | undefined;
        if (!note) {
          await (deps.enqueue ?? defaultEnqueue)([mv.mv_id]);
          queuedAt = new Date().toISOString();
          note = "Đã tự thêm vào hàng chờ dựng.";
        }
        await updateMuse((st) => {
          const cur = st.mvs.find((m) => m.mv_id === mv.mv_id);
          if (cur && awaitingRender(cur)) Object.assign(cur, { note, queued_at: queuedAt });
        });
      }
      state = await readMuse();
    }

    if (state.mvs.some((m) => m.shots.some((s) => !isFinal(s.status)))) return "fast";
    // Còn MV chờ bài hát / chờ đủ clip để tự dựng → dò thưa.
    return settings.museAutoRender && state.mvs.some(awaitingRender) ? "slow" : null;
  });
}

/** Bật vòng dò nền (nếu chưa chạy). Gọi khi gửi cảnh, và mỗi lần trang được mở (app vừa mở lại thì dò tiếp). */
export function ensureMuseWatch(): void {
  if (mem.loop) {
    mem.again = true;
    return;
  }
  mem.loop = (async () => {
    try {
      for (;;) {
        mem.again = false;
        const pace = await museTick().catch((err) => {
          console.error("[muse]", err);
          mem.error = (err as Error).message;
          return "fast" as const;
        });
        if (!pace && !mem.again) return;
        await new Promise((r) => setTimeout(r, pace === "slow" ? IDLE_MS : POLL_MS));
      }
    } finally {
      mem.loop = null;
    }
  })();
}

// ---------- Cho giao diện ----------

export interface MuseView {
  mvs: MuseMV[];
  haohao: HaoHaoInfo;
  /** Lỗi đọc HaoHao ở lượt dò gần nhất. */
  error: string | null;
  autoRender: boolean;
  avoid: boolean;
  defaultDir: string;
}

export async function museView(mvId?: string): Promise<MuseView> {
  const settings = await readSettings();
  const [state, haohao] = await Promise.all([readMuse(), haohaoInfo(haohaoDir(settings.museDataDir))]);
  if (state.mvs.length) ensureMuseWatch();
  return {
    mvs: mvId ? state.mvs.filter((m) => m.mv_id === mvId) : state.mvs,
    haohao,
    error: mem.error,
    autoRender: settings.museAutoRender,
    avoid: settings.museAvoid,
    defaultDir: defaultHaoHaoDir(),
  };
}
