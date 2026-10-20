"use client";

import { useRef, useState } from "react";
import { CopyButton } from "@/components/ui";
import { formatClock, mediaUrl } from "@/lib/client";
import type { EditPlan, MediaFile, Shot } from "@/lib/types";

export const VIDEO_ACCEPT = "video/*,.mp4,.mov,.webm,.mkv,.m4v";

/** Lưới cảnh: mỗi cảnh một ô để thả / chọn clip trả về từ công cụ tạo video. */
export default function ClipGrid({
  mvId,
  shots,
  clips,
  plan,
  busy,
  highlight,
  onHover,
  onUpload,
  onRemove,
  onSwap,
}: {
  mvId: string;
  shots: Shot[];
  clips: Record<string, MediaFile>;
  plan: EditPlan | null;
  busy: boolean;
  highlight: number | null;
  onHover: (shotNo: number | null) => void;
  onUpload: (shotNo: number, file: File) => void;
  onRemove: (shotNo: number) => void;
  onSwap: (a: number, b: number) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {shots.map((s) => (
        <ShotSlot
          key={s.shot_no}
          mvId={mvId}
          shot={s}
          shots={shots}
          clip={clips[String(s.shot_no)]}
          use={plan?.uses[String(s.shot_no)]}
          busy={busy}
          highlight={highlight === s.shot_no}
          onHover={onHover}
          onUpload={onUpload}
          onRemove={onRemove}
          onSwap={onSwap}
        />
      ))}
    </div>
  );
}

function ShotSlot({
  mvId,
  shot,
  shots,
  clip,
  use,
  busy,
  highlight,
  onHover,
  onUpload,
  onRemove,
  onSwap,
}: {
  mvId: string;
  shot: Shot;
  shots: Shot[];
  clip?: MediaFile;
  use?: { count: number; seconds: number };
  busy: boolean;
  highlight: boolean;
  onHover: (shotNo: number | null) => void;
  onUpload: (shotNo: number, file: File) => void;
  onRemove: (shotNo: number) => void;
  onSwap: (a: number, b: number) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [badFile, setBadFile] = useState<string | null>(null);
  const pick = () => input.current?.click();

  return (
    <div
      id={`slot-${shot.shot_no}`}
      className={`flex flex-col rounded-lg border-2 bg-white p-2 transition ${over ? "border-cherry bg-cherry/5" : highlight ? "border-cherry" : "border-ink/25"}`}
      onMouseEnter={() => onHover(shot.shot_no)}
      onMouseLeave={() => onHover(null)}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f && !busy) onUpload(shot.shot_no, f);
      }}
      data-testid={`slot-${shot.shot_no}`}
    >
      <div className="mb-1.5 flex items-center gap-1.5 text-xs">
        <span className="font-head text-base text-cherry">#{shot.shot_no}</span>
        <span className="badge">{shot.section}</span>
        <span className="text-muted">{formatClock(shot.start_sec, 0)}</span>
        {use && (
          <span className="badge ml-auto border-mint-dark/50 bg-mint/30" title="Số lần cảnh này xuất hiện trong MV và tổng thời lượng">
            ×{use.count} · {use.seconds.toFixed(0)}s
          </span>
        )}
      </div>

      {clip ? (
        <>
          {badFile === clip.file ? (
            <div className="flex aspect-video items-center justify-center rounded bg-ink/90 p-2 text-center text-xs text-cream">
              Trình duyệt không xem trước được định dạng này — vẫn dựng được bình thường.
            </div>
          ) : (
            <video
              key={clip.file}
              src={mediaUrl(mvId, clip.file)}
              className="aspect-video w-full rounded bg-black object-contain"
              muted
              controls
              preload="metadata"
              onError={() => setBadFile(clip.file)}
            />
          )}
          <p className="mt-1 truncate text-xs text-muted" title={clip.name}>
            {clip.name} · {clip.duration.toFixed(1)}s{clip.width ? ` · ${clip.width}×${clip.height}` : ""}
          </p>
        </>
      ) : (
        <button
          type="button"
          onClick={pick}
          disabled={busy}
          className="flex aspect-video w-full flex-col items-center justify-center gap-1 rounded border-2 border-dashed border-ink/30 bg-cream/60 text-xs text-muted hover:border-cherry hover:text-cherry"
        >
          <span className="text-2xl">＋</span>
          Thả hoặc chọn clip cảnh #{shot.shot_no}
        </button>
      )}

      <p className="mt-1.5 line-clamp-2 text-xs" title={shot.description_vi}>
        {shot.description_vi}
      </p>
      <div className="mt-auto flex flex-wrap items-center gap-1 pt-2">
        <CopyButton text={shot.prompt_en} label="Copy prompt" />
        {clip && (
          <>
            <button className="btn-ghost btn-sm" onClick={pick} disabled={busy}>
              Thay
            </button>
            <button className="btn-ghost btn-sm" onClick={() => onRemove(shot.shot_no)} disabled={busy}>
              Xoá
            </button>
            <select
              className="input w-auto py-0.5 text-xs"
              value=""
              disabled={busy}
              onChange={(e) => e.target.value && onSwap(shot.shot_no, Number(e.target.value))}
              title="Clip này thật ra là của cảnh khác? Chuyển / đổi chỗ"
            >
              <option value="">Chuyển sang…</option>
              {shots
                .filter((o) => o.shot_no !== shot.shot_no)
                .map((o) => (
                  <option key={o.shot_no} value={o.shot_no}>
                    cảnh #{o.shot_no}
                  </option>
                ))}
            </select>
          </>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept={VIDEO_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onUpload(shot.shot_no, f);
        }}
      />
    </div>
  );
}
