// Cảnh báo trùng lặp giữa các MV trong cùng series.

import { jaccard, shared, tokens } from "./similarity";
import type { DuplicateReport, MVResult } from "./types";

export const PAIR_THRESHOLD = 0.4;
export const MIN_PAIRS = 3;
export const MIN_RATIO = 0.2;

export function seriesKey(series?: string | null): string {
  return (series ?? "").trim() || "__default__";
}

export function mvTitle(mv: Pick<MVResult, "idea">): string {
  return mv.idea.song_title || `#${mv.idea.id} ${mv.idea.world_location}`;
}

export function compareMVs(a: MVResult, b: MVResult): DuplicateReport | null {
  const tb = b.shots.map((s) => tokens(`${s.prompt_core} ${s.camera}`));
  const used = new Set<number>();
  const pairs: DuplicateReport["similar_pairs"] = [];
  for (const sa of a.shots) {
    const ta = tokens(`${sa.prompt_core} ${sa.camera}`);
    let best = -1;
    let bestScore = 0;
    tb.forEach((t, j) => {
      if (used.has(j)) return;
      const score = jaccard(ta, t);
      if (score > bestScore) {
        best = j;
        bestScore = score;
      }
    });
    if (best >= 0 && bestScore >= PAIR_THRESHOLD) {
      used.add(best);
      pairs.push({ shot_no: sa.shot_no, other_shot_no: b.shots[best].shot_no, score: Number(bestScore.toFixed(2)), shared: shared(ta, tb[best]).slice(0, 6) });
    }
  }
  const ratio = a.shots.length ? pairs.length / a.shots.length : 0;
  if (pairs.length < MIN_PAIRS && ratio < MIN_RATIO) return null;
  const list = pairs
    .slice(0, 6)
    .map((p) => `#${p.shot_no} (≈ #${p.other_shot_no}: ${p.shared.slice(0, 3).join(", ")})`)
    .join("; ");
  return {
    other_mv_id: b.id,
    other_title: mvTitle(b),
    similar_pairs: pairs,
    ratio: Number(ratio.toFixed(2)),
    suggestion_vi: `MV này có ${pairs.length} cảnh giống "${mvTitle(b)}". Nên đổi bối cảnh phụ, hành động hoặc góc máy ở: ${list}. Bấm "Sinh lại cảnh này" với yêu cầu "khác MV ${mvTitle(b)}".`,
  };
}

/** Mỗi ý tưởng (theo series + id) chỉ giữ bản mới nhất — các bản sinh lại cũ không tính. */
export function latestPerIdea(mvs: MVResult[]): MVResult[] {
  const map = new Map<string, MVResult>();
  for (const mv of mvs) {
    const key = `${seriesKey(mv.idea.series)}|${mv.idea.id}`;
    const prev = map.get(key);
    if (!prev || prev.created_at < mv.created_at) map.set(key, mv);
  }
  return [...map.values()];
}

export function findSeriesDuplicates(mv: MVResult, all: MVResult[]): DuplicateReport[] {
  const key = seriesKey(mv.idea.series);
  return latestPerIdea(all.filter((o) => o.id !== mv.id && seriesKey(o.idea.series) === key && o.idea.id !== mv.idea.id))
    .map((o) => compareMVs(mv, o))
    .filter((r): r is DuplicateReport => r !== null)
    .sort((x, y) => y.ratio - x.ratio);
}

/** Danh sách ngắn các cảnh/ý tưởng đã dùng trong series để LLM tránh lặp lại. */
export function seriesAvoidList(others: MVResult[], limit = 40): string[] {
  const lines: string[] = [];
  for (const mv of others) {
    const key = mv.shots.filter((s) => /chorus|bridge|pre/i.test(s.section) || s.signature_shot);
    for (const s of key.slice(0, 5)) {
      lines.push(`${mvTitle(mv)} — ${s.section}: ${s.description_vi} (${s.camera})`);
      if (lines.length >= limit) return lines;
    }
  }
  return lines;
}
