// Chia thời lượng bài hát thành danh sách cảnh — thuần code, không gọi LLM.

import type {
  IdeaRow,
  PlannedSection,
  PlannedShot,
  ShotClass,
  SongSection,
  StructurePlan,
  Tempo,
  Theme,
} from "./types";

export const DEFAULT_SONG_STRUCTURE: SongSection[] = [
  { name: "Intro", ratio: 8, role_vi: "Thiết lập bối cảnh: establishing shot, landmark, năm", role_en: "Establish the world: establishing shot, landmark, the year" },
  { name: "Verse 1", ratio: 17, role_vi: "Giới thiệu nhân vật, đời thường", role_en: "Introduce the characters in their everyday life" },
  { name: "Pre-chorus", ratio: 8, role_vi: "Khoảnh khắc khơi mào (ánh mắt, cái chạm)", role_en: "The spark: a glance, a touch" },
  { name: "Chorus 1", ratio: 15, role_vi: "Cao trào cảm xúc của chủ đề", role_en: "First emotional peak of the theme" },
  { name: "Verse 2", ratio: 15, role_vi: "Câu chuyện tiến triển", role_en: "The story develops" },
  { name: "Chorus 2", ratio: 12, role_vi: "Cao trào, nhiều chuyển động hơn", role_en: "Second peak with more movement" },
  { name: "Bridge", ratio: 10, role_vi: "Khoảnh khắc lắng hoặc bước ngoặt", role_en: "A quiet moment or a turning point" },
  { name: "Final chorus", ratio: 10, role_vi: "Cao trào lớn nhất", role_en: "The biggest climax" },
  { name: "Outro", ratio: 5, role_vi: "Kết, cảnh rộng, khép lại câu chuyện", role_en: "Resolution: wide shot that closes the story" },
];

export const MIN_CLIP_LEN = 3;

export interface StructureInput {
  durationSec: number;
  clipLen: number;
  tempo: Tempo;
  bpm?: number | null;
  maxShots?: number | null;
  sections?: SongSection[];
  lyrics?: string | null;
  signatureShots?: string[];
}

export const isChorus = (name: string) => /chorus|điệp khúc/i.test(name) && !/pre/i.test(name);

export function tempoFromBpm(bpm: number): Tempo {
  if (bpm < 95) return "slow";
  if (bpm > 135) return "fast";
  return "mid";
}

/** Ưu tiên: BPM số → tempo chữ → nhịp dựng của chủ đề → mid. */
export function resolveTempo(idea: Pick<IdeaRow, "bpm" | "tempo">, theme?: Pick<Theme, "pacing"> | null): Tempo {
  if (idea.bpm && idea.bpm > 0) return tempoFromBpm(idea.bpm);
  if (idea.tempo) return idea.tempo;
  return theme?.pacing ?? "mid";
}

/** Độ dài clip của một đoạn: nhịp fast thì chorus dùng clip ngắn hơn. */
export function sectionClipLen(sectionName: string, baseClip: number, tempo: Tempo): number {
  if (tempo === "fast" && isChorus(sectionName)) {
    return Math.max(MIN_CLIP_LEN, Math.round(baseClip * 0.6));
  }
  return baseClip;
}

/** Chia `total` thành các phần nguyên theo trọng số, tổng đúng bằng total (largest remainder). */
export function apportion(weights: number[], total: number, minEach = 0): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const sumW = weights.reduce((a, b) => a + b, 0);
  if (sumW <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (w / sumW) * total);
  const counts = exact.map((x, i) => (weights[i] > 0 ? Math.max(minEach, Math.floor(x)) : 0));
  let diff = total - counts.reduce((a, b) => a + b, 0);
  const byRemainder = exact
    .map((x, i) => ({ i, r: x - Math.floor(x) }))
    .filter(({ i }) => weights[i] > 0)
    .sort((a, b) => b.r - a.r || a.i - b.i);
  while (diff > 0 && byRemainder.length) {
    for (const { i } of byRemainder) {
      if (diff === 0) break;
      counts[i]++;
      diff--;
    }
  }
  while (diff < 0) {
    // bớt từ phần có nhiều nhất (ưu tiên phần dư nhỏ) mà vẫn giữ minEach
    const candidates = counts
      .map((c, i) => ({ i, c, r: exact[i] - Math.floor(exact[i]) }))
      .filter(({ c }) => c > Math.max(minEach, 0))
      .sort((a, b) => b.c - a.c || a.r - b.r);
    if (!candidates.length) break;
    counts[candidates[0].i]--;
    diff++;
  }
  return counts;
}

/** Biên nguyên của các đoạn theo tỉ lệ cộng dồn (tổng đúng bằng duration). */
function cumulativeBounds(weights: number[], duration: number): number[] {
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const bounds = [0];
  let acc = 0;
  for (const w of weights) {
    acc += w;
    bounds.push(Math.round((duration * acc) / total));
  }
  bounds[bounds.length - 1] = duration;
  return bounds;
}

// Thứ tự ưu tiên giữ đoạn khi số cảnh ít hơn số đoạn.
const KEEP_PRIORITY = ["intro", "chorus 1", "final chorus", "verse 1", "outro", "bridge", "chorus 2", "verse 2", "pre-chorus"];

function allocateShotCounts(sections: { name: string; duration: number; clip: number }[], maxShots?: number | null) {
  const ideal = sections.map((s) => (s.duration > 0 ? s.duration / s.clip : 0));
  let target = Math.ceil(ideal.reduce((a, b) => a + b, 0) - 1e-9);
  if (maxShots && maxShots > 0) target = Math.min(target, Math.floor(maxShots));
  target = Math.max(1, target);
  const nonEmpty = sections.filter((s) => s.duration > 0).length;
  if (target >= nonEmpty) return apportion(ideal, target, 1);

  // Quá ít cảnh: chỉ giữ các đoạn quan trọng nhất, mỗi đoạn 1 cảnh.
  const ranked = sections
    .map((s, i) => ({ i, rank: KEEP_PRIORITY.indexOf(s.name.toLowerCase()), d: s.duration }))
    .filter((x) => x.d > 0)
    .sort((a, b) => (a.rank === -1 ? 99 : a.rank) - (b.rank === -1 ? 99 : b.rank) || b.d - a.d);
  const counts = sections.map(() => 0);
  for (const { i } of ranked.slice(0, target)) counts[i] = 1;
  return counts;
}

// ---------- Lời bài hát ----------

export interface LyricLine {
  text: string;
  section: string | null;
}

const MARKER_RE =
  /^\s*[\[(]?\s*(final chorus|last chorus|pre[- ]?chorus|chorus|refrain|hook|verse|intro|outro|bridge|interlude|solo|instrumental|điệp khúc cuối|điệp khúc|phiên khúc|dạo đầu|đoạn kết|cầu nối|kết)\s*(\d+)?\s*[\])]?\s*:?\s*$/i;

/** Tách lời bài hát thành từng dòng, gán đoạn nếu lời có nhãn [Verse 1], [Chorus]... */
export function parseLyrics(lyrics: string, sectionNames: string[]): { lines: LyricLine[]; hasMarkers: boolean } {
  const has = (n: string) => sectionNames.find((s) => s.toLowerCase() === n.toLowerCase()) ?? null;
  const lines: LyricLine[] = [];
  let current: string | null = null;
  let hasMarkers = false;
  let verse = 0;
  let chorus = 0;
  let pre = 0;
  for (const raw of lyrics.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(MARKER_RE);
    if (m) {
      hasMarkers = true;
      const kind = m[1].toLowerCase();
      const num = m[2] ? Number(m[2]) : null;
      if (/final|last|cuối/.test(kind)) {
        chorus = Math.max(chorus + 1, 3);
        current = has("Final chorus");
      } else if (/pre/.test(kind)) {
        pre++;
        current = pre === 1 ? has("Pre-chorus") : chorus <= 1 ? has("Verse 2") : has("Bridge");
      } else if (/chorus|refrain|hook|điệp khúc/.test(kind)) {
        chorus = num ?? chorus + 1;
        current = chorus <= 1 ? has("Chorus 1") : chorus === 2 ? has("Chorus 2") : has("Final chorus");
      } else if (/verse|phiên khúc/.test(kind)) {
        verse = num ?? verse + 1;
        current = verse <= 1 ? has("Verse 1") : has("Verse 2");
      } else if (/intro|dạo đầu/.test(kind)) {
        current = has("Intro");
      } else if (/outro|kết/.test(kind)) {
        current = has("Outro");
      } else {
        current = has("Bridge");
      }
      continue;
    }
    lines.push({ text: line, section: current });
  }
  return { lines, hasMarkers };
}

function assignLyrics(shots: PlannedShot[], sections: PlannedSection[], lyrics: string) {
  const names = sections.map((s) => s.name);
  const { lines, hasMarkers } = parseLyrics(lyrics, names);
  if (!lines.length) return;
  const buckets = new Map<number, string[]>();
  const put = (shotIdx: number, text: string) => {
    const list = buckets.get(shotIdx) ?? [];
    list.push(text);
    buckets.set(shotIdx, list);
  };

  const placedBySection = hasMarkers && lines.every((l) => l.section);
  if (placedBySection) {
    for (const sec of sections) {
      const secLines = lines.filter((l) => l.section === sec.name);
      const secShots = shots.map((s, i) => ({ s, i })).filter(({ s }) => s.section === sec.name);
      if (!secLines.length || !secShots.length) continue;
      secLines.forEach((l, k) => {
        const j = Math.min(secShots.length - 1, Math.floor((k * secShots.length) / secLines.length));
        put(secShots[j].i, l.text);
      });
    }
  } else {
    // Không có nhãn đoạn: rải đều theo thời gian trên các đoạn có lời (bỏ Intro/Outro nếu có thể).
    const vocal = shots.filter((s) => !/^(intro|outro)$/i.test(s.section));
    const pool = vocal.length ? vocal : shots;
    const start = pool[0].start_sec;
    const end = pool[pool.length - 1].start_sec + pool[pool.length - 1].duration_sec;
    lines.forEach((l, k) => {
      const t = start + ((k + 0.5) * (end - start)) / lines.length;
      const idx = pool.findIndex((s) => t >= s.start_sec && t < s.start_sec + s.duration_sec);
      const shot = pool[idx === -1 ? pool.length - 1 : idx];
      put(shots.indexOf(shot), l.text);
    });
  }
  buckets.forEach((texts, i) => {
    shots[i].lyric_line = texts.join(" / ");
  });
}

// ---------- Cỡ cảnh, cảnh chuyển động, signature shots ----------

const SIZE_CYCLE: ShotClass[] = ["medium", "close", "wide"];

function assignSizes(shots: PlannedShot[]) {
  const n = shots.length;
  const forced = new Map<number, ShotClass>();
  forced.set(0, "wide");
  if (n > 1) forced.set(n - 1, "wide");
  const firstPre = shots.findIndex((s) => /pre/i.test(s.section));
  if (firstPre > 0 && firstPre < n - 1) forced.set(firstPre, "close");
  shots.forEach((s, i) => {
    if (s.must_motion && !forced.has(i)) forced.set(i, "medium");
  });

  let cycle = 0;
  for (let i = 0; i < n; i++) {
    if (forced.has(i)) {
      shots[i].size_hint = forced.get(i)!;
      continue;
    }
    shots[i].size_hint = SIZE_CYCLE[cycle++ % SIZE_CYCLE.length];
  }
  // Không để hai cảnh liền nhau cùng cỡ.
  for (let i = 1; i < n; i++) {
    if (shots[i].size_hint !== shots[i - 1].size_hint) continue;
    const fixIdx = forced.has(i) && !forced.has(i - 1) ? i - 1 : i;
    if (forced.has(fixIdx) && !shots[fixIdx].must_motion) continue;
    const prev = shots[fixIdx - 1]?.size_hint;
    const next = shots[fixIdx + 1]?.size_hint;
    const options: ShotClass[] = shots[fixIdx].must_motion ? ["medium", "wide"] : SIZE_CYCLE;
    const pick = options.find((c) => c !== prev && c !== next) ?? options.find((c) => c !== prev);
    if (pick) shots[fixIdx].size_hint = pick;
  }
}

function markMotion(shots: PlannedShot[], sections: PlannedSection[]) {
  for (const sec of sections) {
    if (!isChorus(sec.name)) continue;
    const idx = shots.map((s, i) => (s.section === sec.name ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) continue;
    shots[idx[Math.floor(idx.length / 2)]].must_motion = true;
    if (/final/i.test(sec.name) && idx.length >= 3) shots[idx[0]].must_motion = true;
  }
}

const SIGNATURE_SECTION_ORDER = ["pre-chorus", "chorus 1", "final chorus", "bridge", "chorus 2", "verse 2", "verse 1"];

function assignSignatureShots(shots: PlannedShot[], signatureShots: string[]) {
  const sigs = signatureShots.filter(Boolean);
  if (!sigs.length || !shots.length) return;
  // Mỗi signature shot dùng ít nhất 1 lần, tổng cộng ít nhất 2 lần trong MV.
  const wanted = Math.max(2, sigs.length);
  const plan = Array.from({ length: wanted }, (_, k) => sigs[k % sigs.length]);
  const sectionOrder = [...new Set(shots.map((s) => s.section))].sort((a, b) => {
    const ra = SIGNATURE_SECTION_ORDER.indexOf(a.toLowerCase());
    const rb = SIGNATURE_SECTION_ORDER.indexOf(b.toLowerCase());
    return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb);
  });
  const taken = new Set<number>();
  const pickIn = (section: string) => {
    const idx = shots.map((s, i) => (s.section === section && !taken.has(i) && i > 0 ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) return -1;
    const calm = idx.filter((i) => !shots[i].must_motion);
    return (calm.length ? calm : idx)[0];
  };
  let secPtr = 0;
  for (const sig of plan) {
    let chosen = -1;
    for (let tries = 0; tries < sectionOrder.length && chosen === -1; tries++) {
      chosen = pickIn(sectionOrder[secPtr % sectionOrder.length]);
      secPtr++;
    }
    if (chosen === -1) {
      chosen = shots.findIndex((_, i) => !taken.has(i));
      if (chosen === -1) break;
    }
    taken.add(chosen);
    shots[chosen].signature_shot = sig;
  }
}

// ---------- Hàm chính ----------

export function buildStructure(input: StructureInput): StructurePlan {
  const duration = Math.max(1, Math.round(input.durationSec));
  const baseClip = Math.max(MIN_CLIP_LEN, Math.round(input.clipLen));
  const defs = (input.sections?.length ? input.sections : DEFAULT_SONG_STRUCTURE).filter((s) => s.ratio > 0);
  const bounds = cumulativeBounds(
    defs.map((s) => s.ratio),
    duration,
  );
  const raw = defs.map((s, i) => ({
    def: s,
    name: s.name,
    start: bounds[i],
    duration: bounds[i + 1] - bounds[i],
    clip: sectionClipLen(s.name, baseClip, input.tempo),
  }));
  const counts = allocateShotCounts(raw, input.maxShots);

  // Gộp đoạn không có cảnh vào đoạn liền trước (hoặc liền sau) để timeline liên tục.
  const kept: ((typeof raw)[number] & { count: number })[] = [];
  let carryStart: number | null = null;
  raw.forEach((s, i) => {
    if (counts[i] > 0) {
      const start = carryStart ?? s.start;
      kept.push({ ...s, start, duration: s.start + s.duration - start, count: counts[i] });
      carryStart = null;
    } else if (kept.length) {
      kept[kept.length - 1].duration += s.duration;
    } else {
      carryStart = carryStart ?? s.start;
    }
  });

  const sections: PlannedSection[] = [];
  const shots: PlannedShot[] = [];
  for (const s of kept) {
    const n = s.count;
    sections.push({
      name: s.name,
      start_sec: s.start,
      end_sec: s.start + s.duration,
      duration_sec: s.duration,
      shot_count: n,
      clip_len: s.clip,
      role_vi: s.def.role_vi,
      role_en: s.def.role_en,
    });
    for (let k = 0; k < n; k++) {
      const a = s.start + Math.round((s.duration * k) / n);
      const b = s.start + Math.round((s.duration * (k + 1)) / n);
      shots.push({
        shot_no: shots.length + 1,
        section: s.name,
        start_sec: a,
        duration_sec: b - a,
        size_hint: "medium",
        must_motion: false,
        signature_shot: null,
        lyric_line: null,
      });
    }
  }

  markMotion(shots, sections);
  assignSizes(shots);
  assignSignatureShots(shots, input.signatureShots ?? []);
  if (input.lyrics?.trim()) assignLyrics(shots, sections, input.lyrics);

  const notes: string[] = [];
  const bpm = input.bpm && input.bpm > 0 ? input.bpm : null;
  if (input.tempo === "fast") {
    notes.push(`Nhịp nhanh: các đoạn chorus dùng clip ~${sectionClipLen("Chorus", baseClip, "fast")}s để cắt dồn dập hơn.`);
  }
  if (bpm) {
    const bar = (4 * 60) / bpm;
    notes.push(`BPM ${bpm}: 1 phách ≈ ${(60 / bpm).toFixed(2)}s, 1 ô nhịp (4 phách) ≈ ${bar.toFixed(2)}s — nên cắt cảnh trên phách mạnh.`);
  }
  if (input.maxShots && shots.length >= input.maxShots) {
    notes.push(`Đã giới hạn tối đa ${input.maxShots} cảnh; mỗi cảnh sẽ dài hơn độ dài clip mặc định.`);
  }

  return {
    duration_sec: duration,
    clip_len: baseClip,
    tempo: input.tempo,
    bpm,
    total_shots: shots.length,
    sections,
    shots,
    notes,
  };
}

export function formatTime(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
