// Tạo clip bằng Muse — phía server: lưu các cảnh đang làm (data/muse.json), dò công cụ tạo video vài giây một lần,
// clip nào xong thì đưa vào đúng cảnh của đúng MV, MV đủ clip + có bài hát thì tự vào hàng chờ dựng.
// Hai cách gửi (Cài đặt → museMode): "gateway" = Cổng Muse tự gửi từng cảnh; "haohao" = copy prompt để dán vào HaoHao.
// Tắt app giữa chừng: cổng / HaoHao vẫn làm tiếp; mở lại app là dò tiếp từ data/muse.json.

import { promises as fs } from "node:fs";
import path from "node:path";
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
import { gatewayRecheck, gatewaySource, gatewayStatus, gatewaySubmit, type GatewayStatus } from "./museGateway";
import { addToQueue, startQueue } from "./queue";
import { isRendering } from "./render";
import { MUSE_FILE, UPLOAD_DIR, loadMV, readJson, readSettings, withLock, writeJson } from "./store";
import type { MVResult, Settings, Shot } from "./types";

/** Dò mỗi 4 giây khi còn cảnh đang làm; chỉ còn MV chờ bài hát (để tự dựng) thì 30 giây. */
const POLL_MS = 4000;
const IDLE_MS = 30000;
/** Ảnh tham chiếu gửi kèm một cảnh (Muse giới hạn 8 MB / lệnh; chừa chỗ cho phần mã hoá). */
const MAX_REF_BYTES = 7.5 * 1024 * 1024;

// Trạng thái trong tiến trình: vòng dò hiện tại, có yêu cầu dò lại trong lúc vòng cũ sắp dừng, hàm đánh thức vòng dò đang nghỉ,
// lỗi dò gần nhất.
const g = globalThis as unknown as { __mvMuse?: { loop: Promise<void> | null; again: boolean; wake: (() => void) | null; error: string | null } };
const mem = (g.__mvMuse ??= { loop: null, again: false, wake: null, error: null });

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

/** Nguồn task theo cách gửi đang chọn. */
function sourceFor(settings: Settings): MuseSource {
  return settings.museMode === "gateway" ? gatewaySource(settings.museGatewayUrl) : haohaoSource(haohaoDir(settings.museDataDir));
}

const findJob = (s: MuseState, mvId: string, shotNo: number) => s.mvs.find((m) => m.mv_id === mvId)?.shots.find((j) => j.shot_no === shotNo);

/** Cảnh gửi bằng cách khác với cách đang chọn (đổi Cài đặt giữa chừng) → giữ nguyên, chỉ nhắc. */
const OTHER_MODE = {
  gateway: "Cảnh này gửi qua Cổng Muse — chọn lại “Cổng Muse” trong Cài đặt để theo dõi tiếp.",
  haohao: "Cảnh này chờ dán vào HaoHao — chọn lại “HaoHao (dán tay)” trong Cài đặt để theo dõi tiếp, hoặc gửi lại cảnh qua Cổng Muse.",
};
const otherMode = (job: MuseShotJob, gateway: boolean) => Boolean(job.submitted) !== gateway;

/** Ảnh tham chiếu của các nhân vật có trong cảnh (Character Bible), dạng data URL, tổng không quá giới hạn của Muse. */
async function shotImages(mv: MVResult, shot: Shot): Promise<string[]> {
  const ids = new Set(shot.characters_in_shot ?? []);
  const files = mv.character_bible.characters.filter((c) => ids.has(c.id)).flatMap((c) => c.reference_images ?? []);
  const root = path.resolve(/*turbopackIgnore: true*/ UPLOAD_DIR());
  const out: string[] = [];
  let total = 0;
  for (const rel of files) {
    const abs = path.resolve(/*turbopackIgnore: true*/ root, path.relative(path.join("data", "uploads"), rel));
    if (!abs.startsWith(root + path.sep)) continue;
    const buf = await fs.readFile(abs).catch(() => null);
    if (!buf || total + buf.length > MAX_REF_BYTES) continue;
    total += buf.length;
    const ext = path.extname(abs).slice(1).toLowerCase();
    out.push(`data:image/${ext === "jpg" ? "jpeg" : ext};base64,${buf.toString("base64")}`);
  }
  return out;
}

// ---------- Gửi cảnh sang Muse ----------

export interface SendResult {
  /** true = đã gửi thẳng qua Cổng Muse (không cần dán); false = cách HaoHao, `text` là chữ để dán. */
  sent: boolean;
  /** Nội dung để dán vào tab Studio của HaoHao (mỗi prompt cách nhau một dòng trống). */
  text: string;
  /** Số prompt đã gửi / cần dán (= số lượt Muse sẽ dùng). */
  count: number;
  /** Số cảnh nhận luôn video đã có sẵn (cùng prompt), không tốn thêm lượt. */
  reused: number;
  /** Số cảnh gửi qua cổng bị lỗi. */
  failed: number;
  shots: number;
  mvs: number;
  warning?: string;
}

/**
 * Bắt đầu tạo clip cho các MV. Cổng Muse: gửi luôn từng cảnh (kèm ảnh tham chiếu nhân vật). HaoHao: trả chữ để dán.
 * `shots` (khi gửi một MV) = chỉ các cảnh này; `onlyMissing` = chỉ cảnh chưa có clip.
 * Cảnh chưa có clip mà đã có sẵn video cùng prompt → nhận luôn video đó, không gửi lại.
 */
export async function sendToMuse(ids: string[], opts: { shots?: number[]; onlyMissing?: boolean } = {}): Promise<SendResult> {
  if (!ids.length) throw new UserError("Chưa chọn MV nào.");
  const settings = await readSettings();
  const gateway = settings.museMode === "gateway";
  if (gateway) {
    const st = await gatewayStatus(settings.museGatewayUrl);
    if (!st.reachable) throw new UserError(st.error ?? "Chưa kết nối được Cổng Muse.", 503);
  }
  const src = sourceFor(settings);
  let tasks: MuseTask[] = [];
  let warning: string | undefined;
  try {
    tasks = await src.tasks();
  } catch (err) {
    warning = (err as Error).message;
  }
  const now = new Date().toISOString();
  const texts = new Set<string>();
  const toSubmit: { job: MuseShotJob; mv: MVResult; shot: Shot; title: string }[] = [];
  const planned: MuseMV[] = [];
  const state = await readMuse();
  let reused = 0;
  for (const id of ids) {
    const mv = await loadMV(id);
    if (!mv) throw new UserError(`Không tìm thấy MV ${id}.`, 404);
    const project = await loadProject(id);
    const title = mv.idea.song_title || mv.idea.world_location;
    // Không chỉ rõ cảnh → bỏ qua cảnh đang chờ / đang làm (tránh gửi hai lần, tốn hai lượt).
    // Cảnh còn chờ dán vào HaoHao (chưa tốn lượt) thì gửi lại qua cổng được.
    const open = new Set(
      (state.mvs.find((m) => m.mv_id === id)?.shots ?? [])
        .filter((j) => !isFinal(j.status) && j.status !== "error" && !(gateway && j.status === "waiting" && !j.submitted))
        .map((j) => j.shot_no),
    );
    const chosen = mv.shots.filter((s) =>
      opts.shots ? opts.shots.includes(s.shot_no) : !open.has(s.shot_no) && (!opts.onlyMissing || !project.clips[String(s.shot_no)]),
    );
    if (!chosen.length) continue;
    const jobs = chosen.map((s): MuseShotJob => {
      const text = museText(s, { avoid: settings.museAvoid });
      const replaces = project.clips[String(s.shot_no)]?.file ?? null;
      const ready = replaces ? undefined : finishedTask(text, tasks, (f) => src.hasFile(f));
      if (ready) {
        reused++;
        return {
          shot_no: s.shot_no,
          text,
          sent_at: new Date(ready.created_at - 1000).toISOString(),
          status: "queued",
          step: "Đã có sẵn video cùng prompt — đang nhận",
          replaces,
          ...(gateway ? { submitted: true, task_id: ready.id } : {}),
        };
      }
      if (gateway) {
        const job: MuseShotJob = { shot_no: s.shot_no, text, sent_at: now, status: "queued", step: "Đang gửi sang Cổng Muse", replaces, submitted: true };
        toSubmit.push({ job, mv, shot: s, title });
        return job;
      }
      // Hai cảnh trùng nội dung thì chỉ dán một lần — cả hai nhận cùng một clip.
      texts.add(text);
      return { shot_no: s.shot_no, text, sent_at: now, status: "waiting", replaces };
    });
    planned.push({ mv_id: id, title, added_at: now, shots: jobs });
  }
  if (!planned.length) {
    throw new UserError(opts.onlyMissing ? "Không có cảnh nào cần tạo: các cảnh chưa có clip đều đang được Muse làm (hoặc MV đã đủ clip)." : "Không có cảnh nào được chọn.");
  }

  // Cổng Muse: gửi từng cảnh (trùng nội dung thì gửi một lần, các cảnh dùng chung task).
  const byText = new Map<string, string | Error>();
  for (const it of toSubmit) {
    let r = byText.get(it.job.text);
    if (r === undefined) {
      try {
        r = await gatewaySubmit(settings.museGatewayUrl, {
          prompt: it.job.text,
          ratio: "16:9",
          label: `${it.title} · cảnh ${it.shot.shot_no}`,
          images: await shotImages(it.mv, it.shot),
        });
      } catch (err) {
        r = err as Error;
      }
      byText.set(it.job.text, r);
    }
    if (typeof r === "string") Object.assign(it.job, { task_id: r, step: "Đã gửi sang Cổng Muse" });
    else Object.assign(it.job, { status: "error", step: undefined, message: `Không gửi được sang Cổng Muse: ${r.message}` });
  }
  const submitted = [...byText.values()].filter((r) => typeof r === "string").length;

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
  return {
    sent: gateway,
    text: gateway ? "" : pasteText([...texts]),
    count: gateway ? submitted : texts.size,
    reused,
    failed: toSubmit.filter((t) => t.job.status === "error").length,
    shots: planned.reduce((n, p) => n + p.shots.length, 0),
    mvs: planned.length,
    warning,
  };
}

/** Thôi theo dõi các cảnh (hoặc cả MV) — không đụng tới clip đã có, không đụng tới cổng / HaoHao. */
export function forgetMuse(mvId: string, shots?: number[]): Promise<void> {
  return updateMuse((st) => {
    const mv = st.mvs.find((m) => m.mv_id === mvId);
    if (!mv) return;
    mv.shots = shots ? mv.shots.filter((s) => !shots.includes(s.shot_no)) : [];
    st.mvs = st.mvs.filter((m) => m.shots.length);
  });
}

// ---------- Dò, nhận clip, tự dựng ----------

/** Đưa clip của task đã xong vào cảnh. Trả về phần cập nhật của cảnh. */
async function importClip(src: MuseSource, mvId: string, job: MuseShotJob, task: MuseTask): Promise<Partial<MuseShotJob>> {
  // Đang dựng MV này → để lượt dò sau.
  if (isRendering(mvId)) return { status: "running", step: "Chờ dựng xong để đưa clip vào" };
  const fail = (message: string): Partial<MuseShotJob> => ({ status: "error", step: undefined, message, import_error_task: task.id });
  const index = task.files.findIndex((f) => VIDEO_EXT.includes(path.extname(f).toLowerCase()) && src.hasFile(f));
  const missing = "Báo xong nhưng không thấy file video (đã bị xoá hoặc chuyển chỗ?). Gửi lại cảnh này.";
  if (index < 0) return fail(missing);
  const current = (await loadProject(mvId)).clips[String(job.shot_no)]?.file ?? null;
  if (current && current !== job.replaces && current !== job.clip_file) {
    return { status: "kept", step: undefined, message: "Cảnh đã có clip bạn tự thêm sau khi gửi — giữ nguyên, không đè. Muốn dùng clip Muse thì xoá clip đó rồi gửi lại cảnh." };
  }
  try {
    const opened = await src.open(task, index);
    if (!opened) return fail(missing);
    const project = await addClip(mvId, job.shot_no, opened.name, opened.body);
    return { status: "done", step: undefined, clip_file: project.clips[String(job.shot_no)]?.file, done_at: new Date().toISOString() };
  } catch (err) {
    // File đang bận (Windows) → lượt dò sau thử lại, không tính là lỗi.
    if (["EPERM", "EBUSY", "EACCES"].includes((err as NodeJS.ErrnoException).code ?? "")) return { status: "running", step: "File đang bận — sẽ thử đưa clip vào lại" };
    return fail(`Không đưa được clip vào MV: ${(err as Error).message}`);
  }
}

/**
 * Kiểm tra lại các cảnh gửi qua Cổng Muse bị báo lỗi: cổng đọc lại đúng phiên chat cũ, Muse đã làm xong thì tải video về
 * (không gửi lại — không tốn lượt). Trả về số cảnh đã yêu cầu kiểm tra lại.
 */
export async function recheckMuse(mvId: string, shots?: number[]): Promise<number> {
  const settings = await readSettings();
  if (settings.museMode !== "gateway") throw new UserError("Chỉ kiểm tra lại được khi gửi qua Cổng Muse.");
  const state = await readMuse();
  const jobs = (state.mvs.find((m) => m.mv_id === mvId)?.shots ?? []).filter(
    (j) => j.status === "error" && j.submitted && j.task_id && !j.import_error_task && (!shots || shots.includes(j.shot_no)),
  );
  const ok = new Map<number, string>();
  const errors: string[] = [];
  for (const id of new Set(jobs.map((j) => j.task_id!))) {
    try {
      await gatewayRecheck(settings.museGatewayUrl, id);
      for (const j of jobs.filter((x) => x.task_id === id)) ok.set(j.shot_no, id);
    } catch (err) {
      errors.push((err as Error).message);
    }
  }
  await updateMuse((st) => {
    for (const job of st.mvs.find((m) => m.mv_id === mvId)?.shots ?? []) {
      if (ok.get(job.shot_no) === job.task_id && job.status === "error") Object.assign(job, { status: "running", step: "Kiểm tra lại kết quả", message: undefined });
    }
  });
  if (ok.size) ensureMuseWatch();
  if (!ok.size && errors.length) throw new UserError(errors[0]);
  return ok.size;
}

/** Nhận lại clip cho các cảnh mà Muse đã làm xong nhưng đưa vào MV bị lỗi (lấy lại file, không gửi lại — không tốn lượt). */
export async function reimportMuse(mvId: string, shots?: number[]): Promise<number> {
  const n = await updateMuse((st) => {
    let count = 0;
    for (const job of st.mvs.find((m) => m.mv_id === mvId)?.shots ?? []) {
      if (!job.import_error_task || job.status !== "error" || (shots && !shots.includes(job.shot_no))) continue;
      Object.assign(job, { import_error_task: undefined, status: "running", step: "Nhận lại clip", message: undefined });
      count++;
    }
    return count;
  });
  if (n) ensureMuseWatch();
  return n;
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
 * Một lượt dò: cập nhật trạng thái từ cổng / HaoHao, đưa clip đã xong vào MV, tự thêm MV đủ clip + có nhạc vào hàng chờ dựng.
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

    const gatewayMode = settings.museMode === "gateway";
    if (state.mvs.some((m) => m.shots.some((s) => !isFinal(s.status)))) {
      const src = sourceFor(settings);
      let tasks: MuseTask[] | null = null;
      try {
        tasks = await src.tasks();
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
              if (isFinal(job.status)) return job;
              if (otherMode(job, gatewayMode)) return { ...job, message: OTHER_MODE[job.submitted ? "gateway" : "haohao"] };
              // Cảnh gửi qua cổng mà gửi lỗi (chưa có task) → giữ nguyên lỗi.
              if (job.submitted && !job.task_id) return job;
              const current = job.message === OTHER_MODE.gateway || job.message === OTHER_MODE.haohao ? { ...job, message: undefined } : job;
              const r = advanceJob(current, pickTask(current, found));
              if (r.importNow) out.push({ mvId: mv.mv_id, job: r.job, task: r.importNow });
              return r.job;
            });
          }
          return out;
        });
        // Chép clip ngoài khoá (file có thể lớn); cảnh bị gửi lại trong lúc chép thì bỏ kết quả cũ.
        for (const { mvId, job, task } of imports) {
          const patch = await importClip(src, mvId, job, task);
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

    const shots = state.mvs.flatMap((m) => m.shots).filter((s) => !otherMode(s, gatewayMode));
    if (shots.some((s) => s.status === "waiting" || s.status === "queued" || s.status === "running")) return "fast";
    // Chỉ còn cảnh lỗi (có thể được chạy lại bên HaoHao / cổng) hoặc MV chờ bài hát để tự dựng → dò thưa.
    const retryable = shots.some((s) => s.status === "error" && !(s.submitted && !s.task_id));
    return retryable || (settings.museAutoRender && state.mvs.some(awaitingRender)) ? "slow" : null;
  });
}

/**
 * Bật vòng dò nền nếu chưa chạy (app vừa mở lại thì dò tiếp). `wake` = vòng dò đang nghỉ thì dò ngay
 * (sau khi gửi cảnh / nhận lại clip); trang tự tải lại định kỳ thì không cần đánh thức.
 */
export function ensureMuseWatch(wake = true): void {
  if (process.env.MUSE_NO_WATCH) return; // test tự gọi museTick từng lượt
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
        const pace = await museTick().catch((err) => {
          console.error("[muse]", err);
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

// ---------- Cho giao diện ----------

export interface MuseView {
  mode: Settings["museMode"];
  mvs: MuseMV[];
  /** Tình trạng Cổng Muse (khi gửi qua cổng). */
  gateway: GatewayStatus | null;
  /** Tình trạng HaoHao (khi dán tay vào HaoHao). */
  haohao: HaoHaoInfo | null;
  /** Lỗi ở lượt dò gần nhất. */
  error: string | null;
  autoRender: boolean;
  avoid: boolean;
  defaultDir: string;
}

export async function museView(mvId?: string): Promise<MuseView> {
  const settings = await readSettings();
  const gateway = settings.museMode === "gateway";
  const [state, gw, haohao] = await Promise.all([
    readMuse(),
    gateway ? gatewayStatus(settings.museGatewayUrl) : null,
    gateway ? null : haohaoInfo(haohaoDir(settings.museDataDir)),
  ]);
  if (state.mvs.length) ensureMuseWatch(false);
  return {
    mode: settings.museMode,
    mvs: mvId ? state.mvs.filter((m) => m.mv_id === mvId) : state.mvs,
    gateway: gw,
    haohao,
    error: mem.error,
    autoRender: settings.museAutoRender,
    avoid: settings.museAvoid,
    defaultDir: defaultHaoHaoDir(),
  };
}
