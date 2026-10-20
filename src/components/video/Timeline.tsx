"use client";

import { formatClock } from "@/lib/client";
import type { EditPlan, SectionType } from "@/lib/types";

export const SECTION_COLOR: Record<SectionType, string> = {
  intro: "bg-stone-300",
  verse: "bg-sky-200",
  pre: "bg-amber-200",
  chorus: "bg-rose-300",
  final: "bg-rose-400",
  bridge: "bg-emerald-200",
  outro: "bg-stone-400",
  other: "bg-violet-200",
};

/** Timeline xem trước: các đoạn của bài, từng nhát cắt (số cảnh), dạng sóng âm, vạch đang phát. Bấm để tua nhạc. */
export default function Timeline({
  plan,
  waveform,
  now,
  onSeek,
  highlight,
  onHover,
}: {
  plan: EditPlan;
  waveform?: string | null;
  now: number;
  onSeek?: (t: number) => void;
  highlight?: number | null;
  onHover?: (shotNo: number | null) => void;
}) {
  const total = plan.duration || 1;
  const pct = (t: number) => `${(t / total) * 100}%`;
  const step = total > 240 ? 60 : total > 90 ? 30 : total > 30 ? 10 : 5;
  const ticks = Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step);

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onSeek?.(Math.max(0, Math.min(total, ((e.clientX - r.left) / r.width) * total)));
  };

  return (
    <div className="select-none">
      <div className="relative h-5 text-[10px] font-semibold uppercase">
        {plan.sections.map((s, i) => (
          <div
            key={i}
            className={`absolute top-0 h-5 overflow-hidden border-r border-white px-1 leading-5 whitespace-nowrap ${SECTION_COLOR[s.type]}`}
            style={{ left: pct(s.start), width: pct(s.end - s.start) }}
            title={`${s.name}: ${formatClock(s.start)} – ${formatClock(s.end)}`}
          >
            {s.name}
          </div>
        ))}
      </div>
      <div className="relative h-14 cursor-pointer overflow-hidden rounded-b-md border-2 border-t-0 border-ink/70 bg-cream" onClick={seek} data-testid="timeline">
        {waveform && <img src={waveform} alt="" className="pointer-events-none absolute inset-0 h-full w-full opacity-30" draggable={false} />}
        {plan.segments.map((seg, i) => {
          const sec = plan.sections[seg.section_index];
          const hl = highlight === seg.shot_no;
          return (
            <div
              key={i}
              className={`absolute top-0 flex h-full items-center justify-center overflow-hidden border-r-2 border-white/90 text-[10px] font-bold text-ink/80 ${
                SECTION_COLOR[sec?.type ?? "other"]
              } ${hl ? "z-10 outline-2 outline-cherry" : ""} ${i % 2 ? "opacity-80" : "opacity-95"}`}
              style={{ left: pct(seg.start), width: pct(seg.duration) }}
              title={`#${seg.shot_no} · ${formatClock(seg.start)}–${formatClock(seg.start + seg.duration)} (${seg.duration.toFixed(1)}s)${
                seg.use ? ` · lặp lần ${seg.use + 1}, từ giây ${seg.in_point.toFixed(1)} của clip` : ""
              }${seg.flip ? " · lật ngang" : ""}`}
              onMouseEnter={() => onHover?.(seg.shot_no)}
              onMouseLeave={() => onHover?.(null)}
            >
              {seg.duration / total > 0.009 && (
                <span>
                  {seg.shot_no}
                  {seg.flip ? "↔" : ""}
                </span>
              )}
            </div>
          );
        })}
        <div className="pointer-events-none absolute top-0 z-20 h-full w-0.5 bg-cherry" style={{ left: pct(Math.min(now, total)) }} />
      </div>
      <div className="relative h-4 text-[10px] text-muted">
        {ticks.map((t) => (
          <span key={t} className="absolute -translate-x-1/2" style={{ left: pct(t) }}>
            {formatClock(t, 0)}
          </span>
        ))}
      </div>
    </div>
  );
}
