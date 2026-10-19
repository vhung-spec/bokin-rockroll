"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ClipGrid, { VIDEO_ACCEPT } from "@/components/video/ClipGrid";
import EditOptionsCard from "@/components/video/EditOptionsCard";
import ExportStyleCard from "@/components/video/ExportStyleCard";
import Timeline from "@/components/video/Timeline";
import { Card, ErrorBox, Spinner } from "@/components/ui";
import { api, exportUrl, formatBytes, formatClock, mediaUrl, uploadFile } from "@/lib/client";
import { assignClipFiles } from "@/lib/clipNames";
import { RENDER_SIZES, SHARED_ID, autoSectionStarts, buildEdit, editInputFrom } from "@/lib/edit";
import type { EditOptions, EditPlan, LoudnessReport, MVResult, RenderJob, Verification, VideoProject } from "@/lib/types";

interface MediaState {
  project: VideoProject;
  /** Thiết lập dựng dùng chung cho mọi MV. */
  shared: VideoProject;
  bytes: number;
  ffmpeg: { ok: boolean; version: string | null; source: string | null };
  job: RenderJob | null;
}

const AUDIO_ACCEPT = "audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.opus";

export default function VideoPage() {
  const { id } = useParams<{ id: string }>();
  const [mv, setMv] = useState<MVResult | null>(null);
  const [st, setSt] = useState<MediaState | null>(null);
  const [options, setOptions] = useState<EditOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [upload, setUpload] = useState<{ label: string; progress: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [bpmBusy, setBpmBusy] = useState(false);
  const [now, setNow] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [noPlay, setNoPlay] = useState<string | null>(null);
  const [queuedNote, setQueuedNote] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const songInput = useRef<HTMLInputElement>(null);
  const bulkInput = useRef<HTMLInputElement>(null);
  const savedOptions = useRef<string>("");

  const base = `/api/mv/${id}/media`;
  const apply = useCallback((s: MediaState, withOptions = true) => {
    setSt(s);
    if (withOptions) {
      // Thiết lập thực dùng: bản chung + mốc đoạn riêng của bài này.
      const effective = { ...s.shared.options, sectionStarts: s.project.options.sectionStarts };
      setOptions(effective);
      savedOptions.current = JSON.stringify(effective);
    }
  }, []);

  /** Lưu thiết lập: phần chung → thiết lập chung của mọi MV; mốc đoạn → riêng MV này. */
  const saveOptions = useCallback(
    async (next: EditOptions) => {
      const prev = JSON.parse(savedOptions.current || "null") as EditOptions | null;
      const snapshot = JSON.stringify(next);
      const strip = (o: EditOptions | null) => JSON.stringify(o ? { ...o, sectionStarts: null } : null);
      if (strip(prev) !== strip(next)) {
        const { shared } = await api<{ shared: VideoProject }>("/api/video-defaults", { method: "PATCH", json: { options: next } });
        setSt((s) => (s ? { ...s, shared } : s));
      }
      if (JSON.stringify(prev?.sectionStarts ?? null) !== JSON.stringify(next.sectionStarts)) {
        const s = await api<MediaState>(base, { method: "PATCH", json: { action: "sectionStarts", sectionStarts: next.sectionStarts } });
        setSt((cur) => (cur ? { ...cur, project: s.project } : s));
      }
      savedOptions.current = snapshot;
    },
    [base],
  );

  useEffect(() => {
    api<MVResult>(`/api/mv/${id}`).then(setMv).catch((e) => setError(e.message));
    api<MediaState>(base).then((s) => apply(s)).catch((e) => setError(e.message));
  }, [id, base, apply]);

  // Lưu tuỳ chọn (trễ một chút để không gửi liên tục khi đang gõ).
  useEffect(() => {
    if (!options || JSON.stringify(options) === savedOptions.current) return;
    const t = setTimeout(() => saveOptions(options).catch((e) => setError(e.message)), 500);
    return () => clearTimeout(t);
  }, [options, saveOptions]);

  // Theo dõi tiến độ dựng.
  const running = st?.job?.status === "running";
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(async () => {
      try {
        const { job } = await api<{ job: RenderJob | null }>(`/api/mv/${id}/render`);
        if (job?.status !== "running") apply(await api<MediaState>(base), false);
        else setSt((s) => (s ? { ...s, job } : s));
      } catch {
        // thử lại ở lần sau
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [running, id, base, apply]);

  const plan: EditPlan | null = useMemo(
    () => (mv && st && options ? buildEdit(editInputFrom(mv, { ...st.project, options })) : null),
    [mv, st, options],
  );
  const autoStarts = useMemo(
    () => (mv && st ? autoSectionStarts(editInputFrom(mv, { ...st.project, options: options ?? st.project.options })) : []),
    [mv, st, options],
  );

  if (error && (!mv || !st)) return <ErrorBox error={error} />;
  if (!mv || !st || !options || !plan)
    return (
      <p className="text-sm text-muted">
        <Spinner /> Đang tải…
      </p>
    );

  const project = st.project;
  const audio = project.audio;
  const clipCount = mv.shots.filter((s) => project.clips[String(s.shot_no)]).length;
  const title = mv.idea.song_title || mv.idea.world_location;
  const busy = Boolean(upload) || running;
  const size = RENDER_SIZES[options.size];

  async function run<T>(fn: () => Promise<T>) {
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function uploadSong(file: File) {
    await run(async () => {
      setUpload({ label: `Bài hát: ${file.name}`, progress: 0 });
      try {
        const s = await uploadFile<MediaState>(`${base}?kind=audio&name=${encodeURIComponent(file.name)}`, file, (p) =>
          setUpload({ label: p < 1 ? `Bài hát: ${file.name}` : "Đang phân tích nhịp bài hát…", progress: p }),
        );
        apply(s);
      } finally {
        setUpload(null);
      }
    });
  }

  async function uploadClips(items: { shot: number; file: File }[]) {
    await run(async () => {
      try {
        for (const [k, { shot, file }] of items.entries()) {
          const label = `Clip ${k + 1}/${items.length} → cảnh #${shot}: ${file.name}`;
          setUpload({ label, progress: 0 });
          const s = await uploadFile<MediaState>(`${base}?kind=clip&shot=${shot}&name=${encodeURIComponent(file.name)}`, file, (p) => setUpload({ label, progress: p }));
          apply(s, false);
        }
      } finally {
        setUpload(null);
      }
    });
  }

  function uploadMany(files: File[]) {
    const videos = files.filter((f) => /\.(mp4|mov|webm|mkv|m4v)$/i.test(f.name) || f.type.startsWith("video/"));
    if (!videos.length) return setError("Không có file video nào (cần .mp4, .mov, .webm, .mkv).");
    const shotNos = mv!.shots.map((s) => s.shot_no);
    const taken = Object.keys(project.clips).map(Number);
    const target = assignClipFiles(
      videos.map((f) => f.name),
      shotNos,
      taken,
    );
    const items = videos.map((file, i) => ({ file, shot: target[i] })).filter((x): x is { file: File; shot: number } => x.shot !== null);
    const extra = videos.length - items.length;
    setNotice(
      `Đã xếp ${items.length} clip: ${items.map((x) => `${x.file.name} → #${x.shot}`).join(", ")}.` +
        (extra ? ` ${extra} file thừa (không còn cảnh trống) được bỏ qua.` : "") +
        " Xếp sai thì dùng “Chuyển sang…” ở từng cảnh.",
    );
    void uploadClips(items);
  }

  const seek = (t: number) => {
    const a = audioRef.current;
    if (!a) return setNow(t);
    a.currentTime = t;
    setNow(t);
  };
  const playFrom = (t: number) => {
    seek(t);
    void audioRef.current?.play();
  };

  /** Lưu ngay các tuỳ chọn chưa lưu (trước khi dựng / xem thử). */
  async function flushOptions() {
    if (options && JSON.stringify(options) !== savedOptions.current) await saveOptions(options);
  }

  async function uploadAsset(kind: "logo" | "font", file: File) {
    await run(async () => {
      const label = `${kind === "logo" ? "Logo" : "Font"}: ${file.name}`;
      setUpload({ label, progress: 0 });
      try {
        const { shared } = await uploadFile<{ shared: VideoProject }>(`/api/video-defaults?kind=${kind}&name=${encodeURIComponent(file.name)}`, file, (p) =>
          setUpload({ label, progress: p }),
        );
        setSt((s) => (s ? { ...s, shared } : s));
      } finally {
        setUpload(null);
      }
    });
  }

  async function render() {
    await run(async () => {
      await flushOptions();
      const { job } = await api<{ job: RenderJob }>(`/api/mv/${id}/render`, { method: "POST" });
      setSt((s) => (s ? { ...s, job } : s));
    });
  }

  function downloadCutList() {
    const rows = [["stt", "bat_dau", "ket_thuc", "do_dai", "canh", "file_clip", "tu_giay_trong_clip", "lat_ngang", "doan"]];
    plan!.segments.forEach((s, i) => {
      rows.push([
        String(i + 1),
        formatClock(s.start, 2),
        formatClock(s.start + s.duration, 2),
        s.duration.toFixed(2),
        String(s.shot_no),
        project.clips[String(s.shot_no)]?.name ?? "",
        s.in_point.toFixed(2),
        s.flip ? "có" : "",
        plan!.sections[s.section_index]?.name ?? "",
      ]);
    });
    const csv = "﻿" + rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `danh-sach-cat-${mv!.idea.id}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const job = st.job;
  const latest = project.renders[0];
  const avgCut = plan.segments.length ? plan.duration / plan.segments.length : 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <Link href={`/mv/${mv.id}`} className="text-xs uppercase tracking-widest text-muted hover:text-cherry">
            ← MV #{mv.idea.id} · {title}
          </Link>
          <h1 className="text-3xl uppercase">Ghép video với nhạc</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted">
            Tải bài hát và các clip mà công cụ tạo video trả về. App ghép nguyên từng clip theo thứ tự cảnh 1 → {mv.shots.length}, hết lượt thì lặp lại cho tới hết bài
            (không cắt nhỏ clip), rồi xuất ra một file MP4 hoàn chỉnh. Muốn cắt dồn dập theo nhịp nhạc thì chọn “Cắt theo nhịp nhạc” ở bước 3.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 text-xs">
          {st.ffmpeg.ok ? (
            <span className="badge border-mint-dark/50 bg-mint/30">✓ ffmpeg {st.ffmpeg.version}</span>
          ) : (
            <span className="badge border-cherry bg-cherry/10 text-cherry-dark">Chưa có ffmpeg</span>
          )}
          {st.bytes > 0 && <span className="text-muted">Dung lượng: {formatBytes(st.bytes)}</span>}
        </div>
      </div>

      {!st.ffmpeg.ok && (
        <ErrorBox
          error="Không tìm thấy ffmpeg (công cụ dựng video). Hãy đóng app và chạy lại file khởi động để cài thư viện; nếu vẫn chưa được, cài ffmpeg từ https://ffmpeg.org (Windows: winget install ffmpeg · macOS: brew install ffmpeg) rồi mở lại app."
        />
      )}
      <ErrorBox error={error} />
      {upload && (
        <div className="card p-3 text-sm" data-testid="upload-progress">
          <div className="flex items-center gap-2">
            <Spinner /> {upload.label}
            <span className="ml-auto font-semibold">{Math.round(upload.progress * 100)}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-cream-dark">
            <div className="h-full bg-mint-dark transition-all" style={{ width: `${upload.progress * 100}%` }} />
          </div>
        </div>
      )}

      {/* 1. Bài hát */}
      <Card
        title="1. Bài hát"
        actions={
          <>
            <button className="btn-primary btn-sm" onClick={() => songInput.current?.click()} disabled={busy}>
              {audio ? "Đổi bài hát" : "Chọn file nhạc"}
            </button>
            {audio && (
              <button className="btn-ghost btn-sm" disabled={busy} onClick={() => run(async () => apply(await api<MediaState>(`${base}?kind=audio`, { method: "DELETE" })))}>
                Xoá
              </button>
            )}
          </>
        }
      >
        <input
          ref={songInput}
          type="file"
          accept={AUDIO_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void uploadSong(f);
          }}
        />
        {audio ? (
          <div className="space-y-2">
            <p className="text-sm">
              <b>{audio.name}</b> · {formatClock(audio.duration)} · {formatBytes(audio.size)}
              {Math.abs(audio.duration - mv.structure.duration_sec) > 5 && (
                <span className="text-muted">
                  {" "}
                  — storyboard dự kiến {formatClock(mv.structure.duration_sec, 0)}, các đoạn được giãn theo độ dài thật của bài.
                </span>
              )}
            </p>
            <audio
              ref={audioRef}
              src={mediaUrl(mv.id, audio.file)}
              controls
              preload="metadata"
              className="w-full"
              onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
              onSeeked={(e) => setNow(e.currentTarget.currentTime)}
            />
          </div>
        ) : (
          <div
            className="flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-ink/30 bg-cream/60 p-6 text-sm text-muted"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f && !busy) void uploadSong(f);
            }}
          >
            <span className="text-3xl">🎵</span>
            Thả file nhạc vào đây (MP3, WAV, M4A, FLAC…) — app sẽ đo độ dài và nhận nhịp (BPM) để cắt cảnh đúng phách.
          </div>
        )}
      </Card>

      {/* 2. Clip */}
      <Card
        title={`2. Clip video (${clipCount}/${mv.shots.length} cảnh)`}
        actions={
          <>
            <a className="btn-ghost btn-sm" href={exportUrl("prompts-spaced", { ids: [mv.id] })}>
              File prompt (.txt)
            </a>
            <button className="btn-primary btn-sm" onClick={() => bulkInput.current?.click()} disabled={busy}>
              Tải nhiều clip một lúc
            </button>
          </>
        }
      >
        <input
          ref={bulkInput}
          type="file"
          multiple
          accept={VIDEO_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            if (files.length) uploadMany(files);
          }}
        />
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (!busy) uploadMany([...e.dataTransfer.files]);
          }}
        >
          <p className="mb-3 text-xs text-muted">
            Mỗi cảnh một clip. Kéo thả cả thư mục clip vào đây: file có số cảnh trong tên (<code>shot-03.mp4</code>, <code>cảnh 3.mov</code>, <code>03.mp4</code>) tự vào đúng
            cảnh; file không có số được xếp lần lượt (theo tên file) vào các cảnh còn trống. Tiếng của clip được tắt — MV chỉ dùng nhạc của bài hát.
          </p>
          {notice && (
            <p className="mb-3 rounded-md border border-mint-dark/40 bg-mint/15 px-2 py-1 text-xs">
              {notice}
              <button className="ml-2 underline" onClick={() => setNotice(null)}>
                ẩn
              </button>
            </p>
          )}
          <ClipGrid
            mvId={mv.id}
            shots={mv.shots}
            clips={project.clips}
            plan={plan}
            busy={busy}
            highlight={hover}
            onHover={setHover}
            onUpload={(shot, file) => void uploadClips([{ shot, file }])}
            onRemove={(shot) => run(async () => apply(await api<MediaState>(`${base}?kind=clip&shot=${shot}`, { method: "DELETE" }), false))}
            onSwap={(a, b) => run(async () => apply(await api<MediaState>(base, { method: "PATCH", json: { action: "swap", a, b } }), false))}
          />
        </div>
      </Card>

      {/* 3. Cách dựng + timeline */}
      <EditOptionsCard
        options={options}
        onChange={setOptions}
        audio={audio}
        sectionNames={mv.structure.sections.map((s) => s.name)}
        autoStarts={autoStarts}
        now={now}
        onPlayFrom={playFrom}
        bpmBusy={bpmBusy}
        onBpm={(bpm) =>
          run(async () => {
            setBpmBusy(true);
            try {
              apply(await api<MediaState>(base, { method: "PATCH", json: { action: "bpm", bpm } }), false);
            } finally {
              setBpmBusy(false);
            }
          })
        }
      />

      <Card
        title="Xem trước timeline"
        actions={
          plan.segments.length > 0 && (
            <button className="btn-ghost btn-sm" onClick={downloadCutList} title="Danh sách cắt để tự dựng trong CapCut / Premiere nếu muốn">
              Danh sách cắt (.csv)
            </button>
          )
        }
      >
        <Timeline plan={plan} waveform={audio?.waveform ? mediaUrl(mv.id, audio.waveform) : null} now={now} onSeek={audio ? seek : undefined} highlight={hover} onHover={setHover} />
        <p className="mt-2 text-sm">
          {plan.segments.length && options.mode === "full" ? (
            <>
              <b>{Object.keys(plan.uses).length}</b> clip phát nguyên, nối liền theo thứ tự · một vòng dài {formatClock(plan.round_seconds ?? 0, 0)} → lặp{" "}
              <b>{(plan.rounds ?? 0).toFixed(1).replace(".", ",")}</b> vòng cho hết bài {formatClock(plan.duration, 0)} ({plan.segments.length} lượt phát)
              {!audio && <span className="text-muted"> · (đang dùng độ dài dự kiến — tải bài hát để khớp thật)</span>}
            </>
          ) : plan.segments.length ? (
            <>
              <b>{plan.segments.length}</b> nhát cắt · trung bình {avgCut.toFixed(1)} giây/nhát · {Object.keys(plan.uses).length} cảnh, mỗi cảnh xuất hiện khoảng{" "}
              {(plan.segments.length / Math.max(1, Object.keys(plan.uses).length)).toFixed(1)} lần
              {plan.beat && options.snapBeats && <> · cắt theo phách ({(60 / plan.beat).toFixed(1)} BPM)</>}
              {!audio && <span className="text-muted"> · (đang dùng độ dài dự kiến {formatClock(plan.duration, 0)} — tải bài hát để khớp thật)</span>}
            </>
          ) : (
            <span className="text-muted">Chưa có clip nào — tải clip ở bước 2.</span>
          )}
        </p>
        {plan.warnings.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-amber-900">
            {plan.warnings.map((w, i) => (
              <li key={i}>⚠ {w}</li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted">Bấm vào timeline để nghe từ chỗ đó. Rê chuột lên một ô để thấy cảnh tương ứng ở bước 2.</p>
      </Card>

      {/* 4. Âm thanh, logo, intro (cách xuất của Bokin Studio Music) */}
      <ExportStyleCard
        assetOwner={SHARED_ID}
        options={options}
        onChange={setOptions}
        logo={st.shared.logo}
        font={st.shared.font}
        songTitle={title}
        busy={busy}
        onUpload={(kind, file) => void uploadAsset(kind, file)}
        onRemove={(kind) =>
          run(async () => {
            const { shared } = await api<{ shared: VideoProject }>(`/api/video-defaults?kind=${kind}`, { method: "DELETE" });
            setSt((s) => (s ? { ...s, shared } : s));
          })
        }
        onPreview={async (t) => {
          await flushOptions();
          return `/api/mv/${id}/preview?t=${t}&v=${Date.now()}`;
        }}
      />

      {/* 5. Dựng */}
      <Card title="5. Dựng video">
        <div className="flex flex-wrap items-center gap-3">
          <button
            className="btn-primary"
            onClick={render}
            disabled={busy || !st.ffmpeg.ok || !audio || !plan.segments.length}
            data-testid="render"
          >
            🎬 Dựng video
          </button>
          <button
            className="btn-ghost"
            disabled={busy}
            title="Dựng sau, lần lượt cùng các MV khác (thiết lập chung)"
            onClick={() =>
              run(async () => {
                await flushOptions();
                const r = await api<{ added: number }>("/api/render-queue", { method: "POST", json: { action: "add", ids: [id] } });
                setQueuedNote(r.added ? "✓ Đã thêm vào hàng chờ dựng." : "MV này đã có trong hàng chờ dựng.");
              })
            }
          >
            ➕ Thêm vào hàng chờ
          </button>
          <Link href="/render-queue" className="text-sm text-cherry underline">
            {queuedNote ? `${queuedNote} Mở hàng chờ →` : "Hàng chờ dựng →"}
          </Link>
          <span className="text-sm text-muted">
            {!audio
              ? "Cần tải bài hát trước."
              : !plan.segments.length
                ? "Cần ít nhất một clip."
                : `MP4 ${size.w}×${size.h} · ${options.fps} hình/giây · dài ${formatClock(plan.duration, 0)} · ${plan.segments.length} ${options.mode === "full" ? "lượt phát clip" : "nhát cắt"}`}
          </span>
        </div>

        {job?.status === "running" && (
          <div className="mt-3" data-testid="render-progress">
            <div className="flex items-center gap-2 text-sm">
              <Spinner /> {job.stage}
              <span className="ml-auto font-semibold">{Math.round(job.progress * 100)}%</span>
              <button
                className="btn-ghost btn-sm"
                onClick={() =>
                  run(async () => {
                    await api(`/api/mv/${id}/render`, { method: "DELETE" });
                    apply(await api<MediaState>(base), false);
                  })
                }
              >
                Huỷ
              </button>
            </div>
            <div className="mt-2 h-3 overflow-hidden rounded-full border border-ink/30 bg-cream-dark">
              <div className="h-full bg-cherry transition-all" style={{ width: `${job.progress * 100}%` }} />
            </div>
            <p className="mt-1 text-xs text-muted">Có thể mất vài phút với bài dài ở 1080p. Giữ cửa sổ app mở cho tới khi xong.</p>
          </div>
        )}
        {job?.status === "error" && (
          <div className="mt-3">
            <ErrorBox error={`Dựng thất bại: ${job.error}`} />
          </div>
        )}
        {job?.status === "cancelled" && <p className="mt-3 text-sm text-muted">Đã huỷ lần dựng.</p>}

        {latest && (
          <div className="mt-4 grid gap-4 lg:grid-cols-[2fr_1fr]">
            <div>
              <video
                key={latest.file}
                src={mediaUrl(mv.id, latest.file)}
                controls
                className="w-full rounded-lg border-2 border-ink bg-black"
                data-testid="render-video"
                onError={() => setNoPlay(latest.file)}
              />
              {noPlay === latest.file && (
                <p className="mt-1 text-xs text-amber-900">Trình duyệt này không phát được video H.264 — hãy tải file về và mở bằng trình phát video trên máy (hoặc dùng Chrome / Edge / Safari).</p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <a className="btn-mint" href={mediaUrl(mv.id, latest.file, true)} download>
                  ⬇ Tải MP4 về máy
                </a>
                <span className="text-xs text-muted">
                  {formatClock(latest.duration, 0)} · {latest.resolution} · {formatBytes(latest.size)} · dựng trong {latest.seconds_taken}s
                </span>
              </div>
              <RenderReport loudness={latest.loudness} verification={latest.verification} />
              <p className="mt-1 text-xs text-muted">
                File cũng nằm trong thư mục app: <code>data/media/{mv.id}/{latest.file}</code>
              </p>
            </div>
            <div>
              <h3 className="label">Các bản đã dựng</h3>
              <ul className="space-y-1.5">
                {project.renders.map((r) => (
                  <li key={r.file} className="flex items-center gap-2 rounded-md border border-ink/15 bg-white px-2 py-1 text-xs">
                    <span className="min-w-0 flex-1 truncate" title={r.file}>
                      {new Date(r.created_at).toLocaleString("vi-VN")} · {r.resolution} · {formatBytes(r.size)}
                    </span>
                    <a className="btn-ghost btn-sm" href={mediaUrl(mv.id, r.file, true)} download>
                      Tải
                    </a>
                    <button
                      className="btn-ghost btn-sm"
                      onClick={() =>
                        window.confirm("Xoá bản dựng này?") &&
                        run(async () => apply(await api<MediaState>(`${base}?kind=render&file=${encodeURIComponent(r.file)}`, { method: "DELETE" }), false))
                      }
                    >
                      Xoá
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

const db = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(1).replace(".", ",")}`;

/** Kết quả cân bằng âm lượng và kiểm tra đầu ra của một bản dựng. */
function RenderReport({ loudness, verification }: { loudness?: LoudnessReport | null; verification?: Verification }) {
  if (!loudness && !verification) return null;
  const last = loudness?.aac_attempts.at(-1);
  return (
    <ul className="mt-2 space-y-0.5 text-xs" data-testid="render-report">
      {loudness && (
        <li>
          🔊 Âm lượng:{" "}
          {loudness.before.integrated_lufs === null ? (
            "bài quá nhỏ / im lặng, không đo được — giữ nguyên"
          ) : (
            <>
              {db(loudness.before.integrated_lufs)} → {last?.integrated_lufs != null ? db(last.integrated_lufs) : "?"} LUFS (mục tiêu {db(loudness.config.target_lufs)}, gain {db(loudness.final_gain_db)} dB)
              {loudness.peak_limited && " · bị trần đỉnh giới hạn"}
              {loudness.boost_limited && " · đã nâng tối đa 12 dB"}
            </>
          )}
          {last?.true_peak_dbtp != null && <> · đỉnh {db(last.true_peak_dbtp)} dBTP</>}
          {loudness.aac_attempts.length > 1 && <> · mã hoá {loudness.aac_attempts.length} lần để giữ đỉnh dưới trần</>}
        </li>
      )}
      {verification && (
        <li className={verification.passed ? "text-mint-dark" : "text-cherry-dark"}>
          {verification.passed ? "✓" : "✗"} Kiểm tra: {verification.video_frames}/{verification.expected_frames} khung hình · hình {verification.video_seconds.toFixed(2).replace(".", ",")}s · tiếng{" "}
          {verification.audio_seconds.toFixed(2).replace(".", ",")}s · {verification.video_codec.toUpperCase()} + {verification.audio_codec.toUpperCase()}
        </li>
      )}
    </ul>
  );
}
