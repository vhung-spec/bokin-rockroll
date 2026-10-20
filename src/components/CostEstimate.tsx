"use client";

import { estimateCost, formatRange } from "@/lib/cost";
import { buildStructure, resolveTempo } from "@/lib/structure";
import type { IdeaRow, ThemeLibrary } from "@/lib/types";
import type { AppStatus } from "@/lib/useStatus";

/** Ước tính số prompt và chi phí trước khi chạy. */
export default function CostEstimate({ ideas, themes, status }: { ideas: IdeaRow[]; themes: ThemeLibrary; status: AppStatus | null }) {
  if (!status || !ideas.length) return null;
  const shots = ideas.map(
    (idea) =>
      buildStructure({
        durationSec: idea.duration_sec ?? status.defaultDuration,
        clipLen: status.clipLen,
        tempo: resolveTempo(idea, themes[idea.theme_code]),
        minShots: status.minShots,
        maxShots: status.maxShots,
      }).total_shots,
  );
  const totalShots = shots.reduce((a, b) => a + b, 0);
  const n = ideas.length;
  const head = `${n} MV · khoảng ${totalShots} prompt`;

  if (status.mode === "manual") {
    return (
      <p className="rounded-lg border border-sky-400/60 bg-sky-50 px-3 py-2 text-sm">
        {head} · <b>Chế độ claude.ai: không tốn phí API</b> — bạn sẽ copy {n} yêu cầu sang claude.ai rồi dán câu trả lời lại.
      </p>
    );
  }
  if (status.mode === "mock") {
    return (
      <p className="rounded-lg border border-amber-400/60 bg-amber-50 px-3 py-2 text-sm">
        {head} · <b>Chế độ demo: miễn phí</b> (nội dung ghép từ mẫu, không dùng AI).
      </p>
    );
  }
  const ranges = ideas.map((idea, i) => estimateCost(status.price ?? undefined, shots[i], status.effort, idea.lyrics?.length ?? 0));
  if (ranges.some((r) => !r)) {
    return <p className="text-sm text-muted">{head} · chưa có giá cho model {status.model} — thêm trong Cài đặt › Chi phí.</p>;
  }
  const total = ranges.reduce<{ low: number; high: number }>((a, r) => ({ low: a.low + r!.low, high: a.high + r!.high }), { low: 0, high: 0 });
  return (
    <p className="rounded-lg border border-mint-dark/50 bg-mint/15 px-3 py-2 text-sm">
      {head} · <b>Ước tính chi phí Claude API: {formatRange(total, status.usdToVnd)}</b>
      {n > 1 && <span className="text-muted"> · trung bình {formatRange({ low: total.low / n, high: total.high / n }, status.usdToVnd)} / MV</span>}
      <span className="block text-xs text-muted">
        Model {status.model}, effort {status.effort}. Chi phí thật được ghi lại sau khi chạy.
      </span>
    </p>
  );
}
