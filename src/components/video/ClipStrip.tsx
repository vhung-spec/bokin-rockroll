"use client";

import { useState } from "react";
import { mediaUrl } from "@/lib/client";
import type { MediaFile } from "@/lib/types";

/** Tên dài: giữ phần cuối (thường là số thứ tự / giờ tạo — phần phân biệt các clip). */
const shortName = (name: string) => (name.length > 18 ? `…${name.slice(-16)}` : name);

/** Các clip đã tải, theo đúng thứ tự phát (cảnh 1 → N, rồi clip thêm). Không phải chọn gì cho từng clip. */
export default function ClipStrip({
  mvId,
  clips,
  shotCount,
  uses,
  highlight,
  busy,
  onHover,
  onRemove,
}: {
  mvId: string;
  clips: Record<string, MediaFile>;
  shotCount: number;
  uses?: Record<string, { count: number; seconds: number }>;
  highlight: number | null;
  busy: boolean;
  onHover: (n: number | null) => void;
  onRemove: (n: number) => void;
}) {
  const [bad, setBad] = useState<Set<string>>(new Set());
  const order = Object.keys(clips)
    .map(Number)
    .sort((a, b) => a - b);
  return (
    <ol className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-8 xl:grid-cols-10" data-testid="clip-strip">
      {order.map((n, i) => {
        const c = clips[String(n)];
        const extra = n > shotCount;
        return (
          <li
            key={c.file}
            className={`group relative rounded-md border-2 bg-white p-1 ${highlight === n ? "border-cherry" : "border-ink/15"}`}
            onMouseEnter={() => onHover(n)}
            onMouseLeave={() => onHover(null)}
            title={`${c.name} · ${c.duration.toFixed(1)} giây${uses?.[String(n)] ? ` · phát ${uses[String(n)].count} lần` : ""}`}
          >
            {bad.has(c.file) ? (
              <div className="flex aspect-video items-center justify-center rounded bg-ink/90 text-[10px] text-cream">không xem trước được</div>
            ) : (
              <video
                src={`${mediaUrl(mvId, c.file)}#t=0.5`}
                className="aspect-video w-full rounded bg-black object-cover"
                muted
                preload="metadata"
                onError={() => setBad((s) => new Set(s).add(c.file))}
              />
            )}
            <div className="mt-0.5 flex items-center gap-1 text-[11px] leading-tight">
              <b className="text-cherry">{i + 1}</b>
              <span className="min-w-0 flex-1 truncate">{shortName(c.name)}</span>
              <span className="text-muted">{Math.round(c.duration)}s</span>
            </div>
            {extra && <span className="absolute left-1.5 top-1.5 rounded bg-amber-300 px-1 text-[9px] font-bold text-ink">thêm</span>}
            <button
              className="absolute right-1.5 top-1.5 hidden rounded bg-white/90 px-1 text-xs font-bold text-cherry shadow group-hover:block"
              disabled={busy}
              onClick={() => onRemove(n)}
              aria-label={`Bỏ clip ${c.name}`}
            >
              ✕
            </button>
          </li>
        );
      })}
    </ol>
  );
}
