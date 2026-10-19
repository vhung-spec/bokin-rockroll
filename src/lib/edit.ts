// Lập kế hoạch dựng: rải 15–20 clip lên suốt bài hát, lặp lại cảnh theo từng đoạn, cắt theo nhịp.
// Hàm thuần (không đọc file) — dùng chung cho xem trước trên trình duyệt và lúc dựng thật bằng ffmpeg.

import { isChorus } from "./structure";
import type { EditOptions, EditPlan, EditSection, EditSegment, MVResult, SectionType, Tempo, VideoProject } from "./types";

export const DEFAULT_EDIT_OPTIONS: EditOptions = {
  pace: "normal",
  snapBeats: true,
  sectionStarts: null,
  size: "1080p",
  fit: "fill",
  fps: 24,
  flipRepeats: false,
  fadeIn: 1,
  fadeOut: 2,
  seed: 0,
};

export const RENDER_SIZES: Record<EditOptions["size"], { w: number; h: number; label: string }> = {
  "1080p": { w: 1920, h: 1080, label: "1080p ngang (YouTube)" },
  "720p": { w: 1280, h: 720, label: "720p ngang (nhẹ, dựng nhanh)" },
  shorts: { w: 1080, h: 1920, label: "Dọc 9:16 (Shorts / TikTok)" },
};

export function sectionType(name: string): SectionType {
  const n = name.toLowerCase();
  if (/intro|mở đầu/.test(n)) return "intro";
  if (/outro|kết/.test(n)) return "outro";
  if (/pre/.test(n)) return "pre";
  if (isChorus(name)) return /final|cuối/.test(n) ? "final" : "chorus";
  if (/verse|phiên khúc/.test(n)) return "verse";
  if (/bridge|cầu/.test(n)) return "bridge";
  return "other";
}

/** Độ dài một nhát cắt (giây) theo loại đoạn — điệp khúc cắt nhanh, intro/outro giữ lâu. */
const BASE_CUT: Record<SectionType, number> = { intro: 5, verse: 4, pre: 3, chorus: 2.5, final: 2, bridge: 4.5, outro: 5, other: 3.5 };
const PACE_FACTOR: Record<EditOptions["pace"], number> = { slow: 1.4, normal: 1, fast: 0.7 };
const TEMPO_FACTOR: Record<Tempo, number> = { slow: 1.2, mid: 1, fast: 0.85 };
/** Vị trí bắt đầu trong clip ở các lần lặp (tỉ lệ phần dư của clip) — mỗi lần lặp thấy một khúc khác. */
/** Nhát cắt ngắn nhất khi phải chia đều một đoạn ngắn cho nhiều cảnh. */
const MIN_CUT = 0.8;
const IN_POINTS = [0, 0.5, 1, 0.25, 0.75, 0.125, 0.625, 0.375, 0.875];

export interface EditInput {
  /** Các đoạn theo khung bài hát của MV (giây, trên độ dài dự kiến). */
  sections: { name: string; start_sec: number; end_sec: number }[];
  planDuration: number;
  tempo: Tempo;
  shots: { shot_no: number; section: string }[];
  /** Clip đã có, theo số cảnh. */
  clips: Record<string, { duration: number }>;
  /** Độ dài thật của bài hát; null = chưa tải nhạc (dùng độ dài dự kiến). */
  audioDuration: number | null;
  beat: { bpm: number; offset: number } | null;
  options: EditOptions;
}

export function editInputFrom(mv: Pick<MVResult, "structure" | "shots">, project: Pick<VideoProject, "audio" | "clips" | "options">): EditInput {
  const a = project.audio;
  return {
    sections: mv.structure.sections,
    planDuration: mv.structure.duration_sec,
    tempo: mv.structure.tempo,
    shots: mv.shots.map((s) => ({ shot_no: s.shot_no, section: s.section })),
    clips: project.clips,
    audioDuration: a?.duration ?? null,
    beat: a?.bpm ? { bpm: a.bpm, offset: a.beat_offset } : null,
    options: project.options,
  };
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Mốc đoạn tự động: giãn khung bài hát theo độ dài thật, rồi (nếu có nhịp) đặt vào vạch ô nhịp gần nhất. */
export function autoSectionStarts(input: Pick<EditInput, "sections" | "planDuration" | "audioDuration" | "beat">): number[] {
  const duration = input.audioDuration ?? input.planDuration;
  const scale = input.planDuration > 0 ? duration / input.planDuration : 1;
  const bar = input.beat ? (4 * 60) / input.beat.bpm : null;
  return input.sections.map((s, i) => {
    if (i === 0) return 0;
    const t = s.start_sec * scale;
    if (!bar || !input.beat) return round3(t);
    const snapped = input.beat.offset + Math.round((t - input.beat.offset) / bar) * bar;
    return round3(Math.min(duration, Math.max(0, snapped)));
  });
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

function resolveSections(input: EditInput, duration: number): EditSection[] {
  const manual = input.options.sectionStarts;
  const starts = manual && manual.length === input.sections.length ? manual.map((x, i) => (i === 0 ? 0 : x)) : autoSectionStarts(input);
  const sections: EditSection[] = [];
  input.sections.forEach((s, i) => {
    const start = Math.max(starts[i], sections.at(-1)?.start ?? 0);
    sections.push({ name: s.name, type: sectionType(s.name), start, end: duration });
    if (i > 0) sections[i - 1].end = start;
  });
  // Bỏ các đoạn rỗng (mốc trùng nhau hoặc vượt quá cuối bài).
  return sections.filter((s) => s.end - s.start > 0.05 && s.start < duration).map((s) => ({ ...s, end: Math.min(s.end, duration) }));
}

/** Chia một đoạn thành các nhát cắt; trả về các mốc kết thúc (giây). Có lưới phách thì mốc cắt nằm trên phách. */
function cutPoints(start: number, end: number, cut: number, grid: { beat: number; offset: number } | null): number[] {
  const minTail = Math.max(0.6, cut * 0.5);
  const points: number[] = [];
  let next = start + cut;
  if (grid) {
    next = grid.offset + Math.round((next - grid.offset) / grid.beat) * grid.beat;
    if (next - start < minTail) next += grid.beat * Math.ceil((minTail - (next - start)) / grid.beat);
  }
  while (end - next >= minTail) {
    points.push(next);
    next += cut;
  }
  points.push(end);
  return points;
}

export function buildEdit(input: EditInput): EditPlan {
  const { options } = input;
  const fps = options.fps;
  const duration = input.audioDuration ?? input.planDuration;
  const totalFrames = Math.round(duration * fps);
  const warnings: string[] = [];
  const beatLen = options.snapBeats && input.beat && input.beat.bpm > 0 ? 60 / input.beat.bpm : null;
  const sections = resolveSections(input, duration);

  const available = input.shots.filter((s) => (input.clips[String(s.shot_no)]?.duration ?? 0) > 0.2);
  const clipDur = (n: number) => input.clips[String(n)].duration;
  const missing = input.shots.filter((s) => !input.clips[String(s.shot_no)]).map((s) => s.shot_no);

  const plan: EditPlan = { fps, duration, total_frames: totalFrames, beat: beatLen, sections, segments: [], uses: {}, warnings };
  if (!available.length) {
    warnings.push("Chưa có clip nào — hãy tải clip cho các cảnh.");
    return plan;
  }
  if (missing.length) {
    warnings.push(`Còn ${missing.length} cảnh chưa có clip (#${missing.join(", #")}) — đoạn thiếu clip sẽ mượn cảnh cùng loại.`);
  }

  const rand = rng(options.seed);
  const typeOf = new Map(input.sections.map((s) => [s.name, sectionType(s.name)]));
  const related = (a: SectionType, b: SectionType) => a === b || (["chorus", "final"].includes(a) && ["chorus", "final"].includes(b));

  const useCount = new Map<number, number>();
  let prev: number | null = null;
  const raw: { start: number; end: number; shot_no: number; section_index: number }[] = [];

  sections.forEach((sec, si) => {
    // Kho clip của đoạn: cảnh của chính đoạn → thêm cảnh cùng loại nếu ít → mọi cảnh nếu vẫn thiếu.
    const own = available.filter((s) => s.section === sec.name).map((s) => s.shot_no);
    let pool = [...own];
    if (pool.length < 3) {
      const extra = available.filter((s) => s.section !== sec.name && related(typeOf.get(s.section) ?? "other", sec.type)).map((s) => s.shot_no);
      pool.push(...(options.seed ? shuffle(extra, rand) : extra));
    }
    if (pool.length < 2) {
      const all = available.map((s) => s.shot_no).filter((n) => !pool.includes(n));
      pool.push(...(options.seed ? shuffle(all, rand) : all));
    }
    if (options.seed && pool.length > 1) {
      // Giữ cảnh của chính đoạn lên trước, xáo phần lặp.
      pool = [...shuffle(pool.slice(0, own.length), rand), ...pool.slice(own.length)];
    }

    let cut = BASE_CUT[sec.type] * PACE_FACTOR[options.pace] * TEMPO_FACTOR[input.tempo];
    // Đoạn ngắn mà có nhiều cảnh riêng: cắt ngắn lại để cảnh nào cũng được xuất hiện ít nhất một lần.
    const fitAll = own.length > 1 ? (sec.end - sec.start) / own.length : Infinity;
    const mustFit = fitAll < cut;
    if (mustFit) cut = Math.max(MIN_CUT, fitAll);
    if (beatLen) {
      const bar = beatLen * 4;
      const snap = mustFit ? Math.floor : Math.round;
      cut = cut >= bar * 0.75 ? Math.max(1, snap(cut / bar)) * bar : Math.max(1, snap(cut / beatLen)) * beatLen;
    }

    let k = 0;
    let t = sec.start;
    const queue = cutPoints(sec.start, sec.end, cut, beatLen ? { beat: beatLen, offset: input.beat!.offset } : null);
    while (queue.length) {
      const end = queue.shift()!;
      const len = end - t;
      // Chọn clip kế tiếp trong kho, tránh lặp lại clip vừa dùng và ưu tiên clip đủ dài.
      let pick: number | null = null;
      for (let j = 0; j < pool.length; j++) {
        const cand = pool[(k + j) % pool.length];
        if (cand === prev && pool.length > 1) continue;
        if (clipDur(cand) + 1e-6 >= len) {
          pick = cand;
          k = k + j + 1;
          break;
        }
      }
      if (pick === null) {
        // Không clip nào đủ dài: lấy clip dài nhất, phần còn lại thành nhát cắt mới.
        const cands = pool.filter((c) => c !== prev || pool.length === 1);
        pick = cands.reduce((a, b) => (clipDur(b) > clipDur(a) ? b : a), cands[0]);
        k++;
        const usable = clipDur(pick);
        if (usable < len - 0.05) {
          queue.unshift(end);
          raw.push({ start: t, end: t + usable, shot_no: pick, section_index: si });
          t += usable;
        } else {
          raw.push({ start: t, end, shot_no: pick, section_index: si });
          t = end;
        }
        prev = pick;
        continue;
      }
      raw.push({ start: t, end, shot_no: pick, section_index: si });
      t = end;
      prev = pick;
    }
  });

  // Quy về khung hình, liền mạch tuyệt đối từ 0 đến hết bài.
  let frameCursor = 0;
  raw.forEach((r, i) => {
    const endFrame = i === raw.length - 1 ? totalFrames : Math.round(r.end * fps);
    const frames = endFrame - frameCursor;
    if (frames <= 0) return;
    const dur = frames / fps;
    const use = useCount.get(r.shot_no) ?? 0;
    useCount.set(r.shot_no, use + 1);
    const slack = Math.max(0, clipDur(r.shot_no) - dur);
    const inPoint = use === 0 ? 0 : Math.floor(slack * IN_POINTS[use % IN_POINTS.length] * fps) / fps;
    const seg: EditSegment = {
      start_frame: frameCursor,
      frames,
      start: round3(frameCursor / fps),
      duration: round3(dur),
      shot_no: r.shot_no,
      in_point: round3(inPoint),
      flip: options.flipRepeats && use % 2 === 1,
      use,
      section_index: r.section_index,
    };
    plan.segments.push(seg);
    const u = (plan.uses[String(r.shot_no)] ??= { count: 0, seconds: 0 });
    u.count++;
    u.seconds = round3(u.seconds + dur);
    frameCursor = endFrame;
  });

  const unused = available.filter((s) => !plan.uses[String(s.shot_no)]).map((s) => s.shot_no);
  if (unused.length) warnings.push(`Cảnh #${unused.join(", #")} có clip nhưng chưa được dùng (đoạn của cảnh quá ngắn).`);
  const short = available.filter((s) => clipDur(s.shot_no) < 2).map((s) => s.shot_no);
  if (short.length) warnings.push(`Clip cảnh #${short.join(", #")} ngắn dưới 2 giây.`);
  return plan;
}
