"use client";

import { useEffect, useState } from "react";
import { Card, Field } from "@/components/ui";
import { formatClock, parseClock } from "@/lib/client";
import { RENDER_SIZES, sectionType } from "@/lib/edit";
import type { AudioTrack, EditOptions } from "@/lib/types";
import { SECTION_COLOR } from "./Timeline";

const MODES: { value: EditOptions["mode"]; label: string; hint: string }[] = [
  { value: "full", label: "Ghép nguyên clip, lặp đến hết bài", hint: "Mỗi clip phát trọn vẹn theo thứ tự cảnh 1 → N; hết lượt thì lặp lại từ đầu cho tới khi hết nhạc. Không cắt nhỏ clip." },
  { value: "beat", label: "Cắt theo nhịp nhạc", hint: "Cắt clip thành nhiều nhát ngắn (2–5 giây), mỗi đoạn của bài dùng cảnh của đoạn đó, điểm cắt đúng phách." },
];

const PACES: { value: EditOptions["pace"]; label: string }[] = [
  { value: "slow", label: "Chậm — cảnh dài, êm" },
  { value: "normal", label: "Vừa" },
  { value: "fast", label: "Nhanh — cắt dồn dập" },
];

/** Tuỳ chọn dựng + mốc các đoạn trong bài hát. */
export default function EditOptionsCard({
  options,
  onChange,
  audio,
  sectionNames,
  autoStarts,
  now,
  onPlayFrom,
  onBpm,
  bpmBusy,
}: {
  options: EditOptions;
  onChange: (o: EditOptions) => void;
  audio: AudioTrack | null;
  sectionNames: string[];
  autoStarts: number[];
  now: number;
  onPlayFrom: (t: number) => void;
  onBpm: (bpm: number | null) => void;
  bpmBusy: boolean;
}) {
  const set = <K extends keyof EditOptions>(k: K, v: EditOptions[K]) => onChange({ ...options, [k]: v });
  const full = options.mode === "full";
  const starts = options.sectionStarts && options.sectionStarts.length === sectionNames.length ? options.sectionStarts : autoStarts;
  const setStart = (i: number, t: number) => {
    const next = [...starts];
    next[i] = Math.round(t * 100) / 100;
    set("sectionStarts", next);
  };
  const [bpmText, setBpmText] = useState(audio?.bpm ? String(audio.bpm) : "");
  useEffect(() => setBpmText(audio?.bpm ? String(audio.bpm) : ""), [audio?.bpm]);

  return (
    <Card title="3. Cách dựng">
      <div className="mb-3 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Cách ghép clip">
        {MODES.map((m) => (
          <label
            key={m.value}
            className={`flex cursor-pointer items-start gap-2 rounded-lg border-2 p-2.5 text-sm ${options.mode === m.value ? "border-cherry bg-cherry/5" : "border-ink/20 bg-white"}`}
          >
            <input type="radio" className="mt-1" name="edit-mode" checked={options.mode === m.value} onChange={() => set("mode", m.value)} />
            <span>
              <b>{m.label}</b>
              <span className="block text-xs text-muted">{m.hint}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {!full && (
          <Field label="Nhịp cắt cảnh" hint="Điệp khúc luôn cắt nhanh hơn verse.">
            <select className="input" value={options.pace} onChange={(e) => set("pace", e.target.value as EditOptions["pace"])}>
              {PACES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Khung hình">
          <select className="input" value={options.size} onChange={(e) => set("size", e.target.value as EditOptions["size"])}>
            {Object.entries(RENDER_SIZES).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Clip khác khung hình">
          <select className="input" value={options.fit} onChange={(e) => set("fit", e.target.value as EditOptions["fit"])}>
            <option value="fill">Cắt cho đầy khung</option>
            <option value="fit">Giữ nguyên, thêm viền đen</option>
          </select>
        </Field>
        <Field label="Số hình / giây">
          <select className="input" value={options.fps} onChange={(e) => set("fps", Number(e.target.value) as EditOptions["fps"])}>
            <option value={24}>24 (chất phim điện ảnh)</option>
            <option value={30}>30</option>
          </select>
        </Field>
        <Field label="Mờ dần lúc mở đầu (giây)">
          <input className="input" type="number" min={0} max={10} step={0.5} value={options.fadeIn} onChange={(e) => set("fadeIn", Math.max(0, Math.min(10, Number(e.target.value) || 0)))} />
        </Field>
        <Field label="Mờ dần lúc kết thúc (giây)">
          <input className="input" type="number" min={0} max={10} step={0.5} value={options.fadeOut} onChange={(e) => set("fadeOut", Math.max(0, Math.min(10, Number(e.target.value) || 0)))} />
        </Field>
        <Field
          label="Thứ tự lặp cảnh"
          hint={
            full
              ? options.seed
                ? `Vòng đầu theo thứ tự 1 → N, các vòng sau xáo (kiểu #${options.seed}).`
                : "Vòng nào cũng theo thứ tự 1 → N."
              : options.seed
                ? `Kiểu xáo #${options.seed}`
                : "Lần đầu theo đúng thứ tự storyboard."
          }
        >
          <div className="flex gap-2">
            <button type="button" className="btn-ghost btn-sm" onClick={() => set("seed", 1 + Math.floor(Math.random() * 999_999))}>
              🎲 {full ? "Xáo các vòng sau" : "Xáo lại"}
            </button>
            {options.seed > 0 && (
              <button type="button" className="btn-ghost btn-sm" onClick={() => set("seed", 0)}>
                Theo thứ tự cảnh
              </button>
            )}
          </div>
        </Field>
        <label className="flex items-start gap-2 pt-5 text-sm">
          <input type="checkbox" className="mt-1" checked={options.flipRepeats} onChange={(e) => set("flipRepeats", e.target.checked)} />
          <span>
            Lật ngang khi lặp lại
            <span className="block text-xs text-muted">Đỡ nhàm khi một cảnh xuất hiện nhiều lần.</span>
          </span>
        </label>
      </div>

      {!full && (
        <>
          <div className="mt-4 rounded-lg border border-ink/15 bg-cream/50 p-3">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={options.snapBeats} disabled={!audio?.bpm} onChange={(e) => set("snapBeats", e.target.checked)} />
                <span className="font-semibold">Cắt đúng phách nhạc</span>
              </label>
              {audio ? (
                audio.bpm ? (
                  <span className="text-muted">
                    Nhịp {audio.bpm_source === "manual" ? "đặt tay" : "nhận được"}: <b className="text-ink">{audio.bpm} BPM</b>
                    {audio.bpm_source === "auto" && ` (độ tin cậy ${Math.round(audio.beat_confidence * 100)}%)`}
                  </span>
                ) : (
                  <span className="text-muted">Chưa nhận ra nhịp của bài — nhập BPM nếu bạn biết.</span>
                )
              ) : (
                <span className="text-muted">Tải bài hát lên để nhận nhịp.</span>
              )}
              {audio && (
                <span className="ml-auto flex items-center gap-1.5">
                  <input
                    className="input w-24 py-1 text-xs"
                    type="number"
                    min={40}
                    max={260}
                    step={0.1}
                    placeholder="BPM"
                    value={bpmText}
                    onChange={(e) => setBpmText(e.target.value)}
                  />
                  <button className="btn-ghost btn-sm" disabled={bpmBusy || !Number(bpmText)} onClick={() => onBpm(Number(bpmText))}>
                    Đặt BPM
                  </button>
                  {audio.bpm_source === "manual" && (
                    <button className="btn-ghost btn-sm" disabled={bpmBusy} onClick={() => onBpm(null)}>
                      Tự nhận lại
                    </button>
                  )}
                </span>
              )}
            </div>
          </div>

          <details className="mt-4" open={Boolean(options.sectionStarts)}>
            <summary className="cursor-pointer text-sm font-semibold">
              Mốc các đoạn trong bài {options.sectionStarts ? "(đã chỉnh tay)" : "(tự chia theo khung bài hát)"}
            </summary>
            <p className="mt-2 text-xs text-muted">
              Mặc định app chia bài theo tỉ lệ Intro / Verse / Chorus… của storyboard. Nếu điệp khúc thật bắt đầu ở chỗ khác, hãy phát nhạc ở trên và bấm
              <b> ⏱ Đặt ở đây</b> đúng lúc đoạn đó bắt đầu — cảnh của đoạn sẽ rơi đúng chỗ.
            </p>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {sectionNames.map((name, i) => (
                <div key={name + i} className="flex items-center gap-1.5 rounded-md border border-ink/15 bg-white px-2 py-1">
                  <span className={`h-3 w-3 shrink-0 rounded-full ${SECTION_COLOR[sectionType(name)]}`} />
                  <span className="w-28 truncate text-xs font-semibold" title={name}>
                    {name}
                  </span>
                  <ClockInput value={starts[i]} disabled={i === 0} onCommit={(t) => setStart(i, t)} />
                  {i > 0 && (
                    <button className="btn-ghost btn-sm" disabled={!audio} onClick={() => setStart(i, now)} title="Đặt mốc bằng vị trí nhạc đang phát">
                      ⏱ Đặt ở đây
                    </button>
                  )}
                  <button className="btn-ghost btn-sm ml-auto" disabled={!audio} onClick={() => onPlayFrom(starts[i])} title="Nghe từ mốc này">
                    ▶
                  </button>
                </div>
              ))}
            </div>
            {options.sectionStarts && (
              <button className="btn-ghost btn-sm mt-2" onClick={() => set("sectionStarts", null)}>
                ↺ Về tự chia
              </button>
            )}
          </details>
        </>
      )}
    </Card>
  );
}

function ClockInput({ value, onCommit, disabled }: { value: number; onCommit: (t: number) => void; disabled?: boolean }) {
  const [text, setText] = useState(formatClock(value));
  useEffect(() => setText(formatClock(value)), [value]);
  const commit = () => {
    const t = parseClock(text);
    if (t === null) setText(formatClock(value));
    else if (Math.abs(t - value) > 0.001) onCommit(t);
  };
  return (
    <input
      className="input w-20 px-1.5 py-0.5 text-center font-mono text-xs"
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
    />
  );
}
