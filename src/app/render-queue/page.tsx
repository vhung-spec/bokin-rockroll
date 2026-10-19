"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import EditOptionsCard from "@/components/video/EditOptionsCard";
import ExportStyleCard from "@/components/video/ExportStyleCard";
import { Card, ErrorBox, Spinner } from "@/components/ui";
import { api, formatBytes, formatClock, mediaUrl, uploadFile } from "@/lib/client";
import { RENDER_SIZES, SHARED_ID } from "@/lib/edit";
import { QUALITY_LABEL } from "@/lib/quality";
import type { QueueItem, QueueState } from "@/lib/queue";
import type { EditOptions, RenderJob, VideoProject } from "@/lib/types";

interface Candidate {
  id: string;
  idea_id: string;
  title: string;
  series: string;
  created_at: string;
  shot_count: number;
  clip_count: number;
  audio: { name: string; duration: number } | null;
  last_render: { file: string; created_at: string; size: number } | null;
}

type Queue = QueueState & { job: RenderJob | null };

const STATUS: Record<QueueItem["status"], { label: string; cls: string }> = {
  waiting: { label: "Đang chờ", cls: "border-ink/30 bg-cream" },
  running: { label: "Đang dựng", cls: "border-cherry bg-cherry/10 text-cherry-dark" },
  done: { label: "Xong", cls: "border-mint-dark/60 bg-mint/30" },
  error: { label: "Lỗi", cls: "border-cherry bg-cherry/10 text-cherry-dark" },
  skipped: { label: "Bỏ qua", cls: "border-amber-500 bg-amber-100 text-amber-900" },
  cancelled: { label: "Đã huỷ", cls: "border-ink/30 bg-chrome/40" },
};

const ready = (c: Candidate) => Boolean(c.audio) && c.clip_count > 0;

export default function RenderQueuePage() {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [mvs, setMvs] = useState<Candidate[] | null>(null);
  const [shared, setShared] = useState<VideoProject | null>(null);
  const [options, setOptions] = useState<EditOptions | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [series, setSeries] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [upload, setUpload] = useState<string | null>(null);
  const saved = useRef("");

  const refresh = useCallback(async () => {
    const r = await api<{ queue: Queue; mvs: Candidate[] }>("/api/render-queue");
    setQueue(r.queue);
    setMvs(r.mvs);
  }, []);

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    api<{ shared: VideoProject }>("/api/video-defaults")
      .then(({ shared }) => {
        setShared(shared);
        setOptions(shared.options);
        saved.current = JSON.stringify(shared.options);
      })
      .catch((e) => setError(e.message));
  }, [refresh]);

  // Cập nhật tiến độ: nhanh khi đang dựng, chậm khi rảnh.
  const active = Boolean(queue?.running || queue?.items.some((i) => i.status === "running"));
  useEffect(() => {
    const t = setInterval(() => refresh().catch(() => {}), active ? 1500 : 6000);
    return () => clearInterval(t);
  }, [active, refresh]);

  // Lưu thiết lập chung (trễ một chút khi đang gõ).
  const saveOptions = useCallback(async (next: EditOptions) => {
    const snapshot = JSON.stringify(next);
    const r = await api<{ shared: VideoProject }>("/api/video-defaults", { method: "PATCH", json: { options: next } });
    saved.current = snapshot;
    setShared(r.shared);
  }, []);
  useEffect(() => {
    if (!options || JSON.stringify(options) === saved.current) return;
    const t = setTimeout(() => saveOptions(options).catch((e) => setError(e.message)), 500);
    return () => clearTimeout(t);
  }, [options, saveOptions]);

  const seriesList = useMemo(() => [...new Set((mvs ?? []).map((m) => m.series).filter(Boolean))].sort(), [mvs]);
  const visible = useMemo(
    () =>
      (mvs ?? []).filter(
        (m) => (!series || m.series === series) && (!search || `${m.title} ${m.idea_id} ${m.series}`.toLowerCase().includes(search.toLowerCase())),
      ),
    [mvs, series, search],
  );
  const byId = useMemo(() => new Map((mvs ?? []).map((m) => [m.id, m])), [mvs]);
  const inQueue = useMemo(
    () => new Map((queue?.items ?? []).filter((i) => i.status === "waiting" || i.status === "running").map((i) => [i.mv_id, i.status])),
    [queue],
  );

  if (error && (!queue || !options)) return <ErrorBox error={error} />;
  if (!queue || !mvs || !options || !shared)
    return (
      <p className="text-sm text-muted">
        <Spinner /> Đang tải…
      </p>
    );

  async function act(json: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      if (JSON.stringify(options) !== saved.current) await saveOptions(options!);
      const r = await api<{ queue: Queue }>("/api/render-queue", { method: "POST", json });
      setQueue(r.queue);
      return r;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function addSelected(start: boolean) {
    const ids = [...selected];
    const r = await act({ action: "add", ids, start });
    if (r) setSelected(new Set());
  }

  async function uploadAsset(kind: "logo" | "font", file: File) {
    setUpload(`${kind === "logo" ? "Logo" : "Font"}: ${file.name}`);
    setError(null);
    try {
      const r = await uploadFile<{ shared: VideoProject }>(`/api/video-defaults?kind=${kind}&name=${encodeURIComponent(file.name)}`, file);
      setShared(r.shared);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUpload(null);
    }
  }

  const counts = queue.items.reduce<Record<string, number>>((a, i) => ((a[i.status] = (a[i.status] ?? 0) + 1), a), {});
  const waiting = counts.waiting ?? 0;
  const running = queue.items.find((i) => i.status === "running");
  const finished = queue.items.filter((i) => i.status !== "waiting" && i.status !== "running").length;
  const previewMv = [...queue.items.map((i) => byId.get(i.mv_id)), ...mvs].find((m) => m && m.clip_count > 0) ?? null;
  const size = RENDER_SIZES[options.size];
  const loud = options.loudness.enabled ? `${options.loudness.target_lufs} LUFS` : "giữ nguyên âm lượng";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl uppercase">Hàng chờ dựng video</h1>
        <p className="mt-1 max-w-4xl text-sm text-muted">
          Chọn thiết lập <b>một lần</b>, chọn các MV đã có bài hát + clip, rồi bấm <b>▶ Chạy</b> — app dựng lần lượt từng MV (mỗi lúc một MV để máy không bị quá tải).
          Nhạc và clip của từng MV vẫn tải ở trang “Ghép video” của MV đó.
        </p>
      </div>
      <ErrorBox error={error} />

      {/* 1. Thiết lập chung */}
      <details className="card p-4" open={!queue.items.length}>
        <summary className="cursor-pointer">
          <span className="card-title">1. Thiết lập dựng (dùng chung cho mọi MV)</span>
          <span className="ml-2 text-sm text-muted">
            {options.mode === "full" ? "Ghép nguyên clip, lặp đến hết bài" : "Cắt theo nhịp nhạc"} · {size.w}×{size.h} · {options.quality === "youtube" ? "YouTube" : "Nhanh"} · {loud}
            {shared.logo && " · logo"}
            {options.intro.enabled && " · intro tiêu đề"} — bấm để {""}
            <span className="underline">xem / sửa</span>
          </span>
        </summary>
        <div className="mt-4 space-y-5">
          {upload && (
            <p className="text-sm">
              <Spinner /> Đang tải {upload}…
            </p>
          )}
          <EditOptionsCard
            title="Cách dựng"
            global
            options={options}
            onChange={setOptions}
            audio={null}
            sectionNames={[]}
            autoStarts={[]}
            now={0}
            onPlayFrom={() => {}}
            onBpm={() => {}}
            bpmBusy={false}
          />
          <ExportStyleCard
            assetOwner={SHARED_ID}
            title="Âm thanh, logo & intro"
            canPreview={Boolean(previewMv)}
            options={options}
            onChange={setOptions}
            logo={shared.logo}
            font={shared.font}
            songTitle="tên bài của từng MV"
            busy={busy || Boolean(upload)}
            onUpload={(kind, file) => void uploadAsset(kind, file)}
            onRemove={async (kind) => {
              try {
                const r = await api<{ shared: VideoProject }>(`/api/video-defaults?kind=${kind}`, { method: "DELETE" });
                setShared(r.shared);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
            onPreview={async (t) => {
              if (JSON.stringify(options) !== saved.current) await saveOptions(options);
              return `/api/mv/${previewMv!.id}/preview?t=${t}&v=${Date.now()}`;
            }}
          />
          {previewMv && <p className="text-xs text-muted">Xem thử dùng clip của MV “{previewMv.title}”.</p>}
        </div>
      </details>

      {/* 2. Chọn MV */}
      <Card
        title="2. Chọn MV để dựng"
        actions={
          <>
            <button className="btn-ghost btn-sm" onClick={() => setSelected(new Set(visible.filter((m) => ready(m) && !inQueue.has(m.id)).map((m) => m.id)))}>
              Chọn tất cả MV đủ nhạc + clip
            </button>
            {selected.size > 0 && (
              <button className="btn-ghost btn-sm" onClick={() => setSelected(new Set())}>
                Bỏ chọn
              </button>
            )}
          </>
        }
      >
        <div className="mb-3 flex flex-wrap gap-2">
          <input className="input max-w-xs" placeholder="Tìm theo tên bài, mã, series…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {seriesList.length > 0 && (
            <select className="input w-auto" value={series} onChange={(e) => setSeries(e.target.value)}>
              <option value="">Mọi series</option>
              {seriesList.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
        </div>
        {!mvs.length ? (
          <p className="text-sm text-muted">
            Chưa có MV nào. <Link href="/" className="text-cherry underline">Tạo MV</Link> trước.
          </p>
        ) : (
          <div className="max-h-[28rem] overflow-auto rounded-lg border border-ink/15">
            <table className="w-full text-sm" data-testid="mv-table">
              <thead className="sticky top-0 bg-cream-dark text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="w-8 px-2 py-1.5"></th>
                  <th className="px-2 py-1.5">MV</th>
                  <th className="px-2 py-1.5">Bài hát</th>
                  <th className="px-2 py-1.5">Clip</th>
                  <th className="px-2 py-1.5">Bản dựng gần nhất</th>
                  <th className="px-2 py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((m) => {
                  const ok = ready(m);
                  const q = inQueue.get(m.id);
                  return (
                    <tr key={m.id} className={`border-t border-ink/10 ${ok ? "" : "text-muted"}`}>
                      <td className="px-2 py-1.5">
                        <input
                          type="checkbox"
                          disabled={!ok || Boolean(q)}
                          checked={selected.has(m.id)}
                          title={!ok ? "Cần tải bài hát và ít nhất một clip trước" : q ? "Đã có trong hàng chờ" : ""}
                          onChange={() =>
                            setSelected((s) => {
                              const n = new Set(s);
                              if (n.has(m.id)) n.delete(m.id);
                              else n.add(m.id);
                              return n;
                            })
                          }
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="font-semibold text-ink">
                          #{m.idea_id} · {m.title}
                        </div>
                        {m.series && <div className="text-xs text-muted">{m.series}</div>}
                      </td>
                      <td className="px-2 py-1.5">{m.audio ? `✓ ${formatClock(m.audio.duration, 0)}` : <span className="text-cherry-dark">✗ chưa có</span>}</td>
                      <td className="px-2 py-1.5">
                        <span className={m.clip_count === 0 ? "text-cherry-dark" : m.clip_count < m.shot_count ? "text-amber-800" : ""}>
                          {m.clip_count}/{m.shot_count}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-xs">
                        {m.last_render ? (
                          <a className="text-cherry underline" href={mediaUrl(m.id, m.last_render.file, true)} download>
                            {new Date(m.last_render.created_at).toLocaleString("vi-VN")} · {formatBytes(m.last_render.size)}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right text-xs">
                        {q && <span className={`badge mr-2 ${STATUS[q].cls}`}>{STATUS[q].label}</span>}
                        <Link href={`/mv/${m.id}/video`} className="text-cherry underline">
                          {ok ? "Mở" : "Tải nhạc / clip"}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button className="btn-ghost" disabled={!selected.size || busy} onClick={() => addSelected(false)}>
            ➕ Thêm {selected.size || ""} MV vào hàng chờ
          </button>
          <button className="btn-primary" disabled={!selected.size || busy} onClick={() => addSelected(true)} data-testid="add-and-run">
            ➕ Thêm & ▶ chạy ngay
          </button>
        </div>
      </Card>

      {/* 3. Hàng chờ */}
      <Card
        title={`3. Hàng chờ (${queue.items.length})`}
        actions={
          <>
            {!queue.running && waiting > 0 && (
              <button className="btn-primary btn-sm" disabled={busy} onClick={() => act({ action: "start" })} data-testid="queue-start">
                ▶ Chạy hàng chờ ({waiting})
              </button>
            )}
            {queue.running && (
              <button className="btn-ghost btn-sm" disabled={busy} onClick={() => act({ action: "pause" })} title="Dựng xong MV hiện tại rồi dừng">
                ‖ Dừng sau MV này
              </button>
            )}
            {running && (
              <button className="btn-ghost btn-sm" disabled={busy} onClick={() => window.confirm("Huỷ MV đang dựng và dừng hàng chờ?") && act({ action: "cancel" })}>
                ✖ Huỷ MV đang dựng
              </button>
            )}
            {finished > 0 && (
              <button className="btn-ghost btn-sm" disabled={busy} onClick={() => act({ action: "clear" })}>
                Xoá các mục đã xong
              </button>
            )}
          </>
        }
      >
        <p className="mb-3 text-sm">
          {queue.running ? (
            <span className="font-semibold text-cherry">
              <Spinner /> Đang chạy
            </span>
          ) : (
            <span className="text-muted">Đang dừng</span>
          )}
          {" · "}
          {(["waiting", "done", "skipped", "error", "cancelled"] as const)
            .filter((k) => counts[k])
            .map((k) => `${STATUS[k].label} ${counts[k]}`)
            .join(" · ") || "Chưa có MV nào"}
          {" · "}
          <span className="text-muted">
            {options.mode === "full" ? "ghép nguyên clip" : "cắt theo nhịp"}, {size.w}×{size.h}, {QUALITY_LABEL[options.quality].split(" — ")[0]}
          </span>
        </p>
        {!queue.items.length ? (
          <p className="text-sm text-muted">Chọn MV ở bước 2 rồi bấm “Thêm vào hàng chờ”.</p>
        ) : (
          <ol className="space-y-1.5" data-testid="queue-list">
            {queue.items.map((it, n) => {
              const m = byId.get(it.mv_id);
              const job = it.status === "running" ? queue.job : null;
              return (
                <li key={it.id} className="rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-6 text-right font-head text-muted">{n + 1}.</span>
                    <span className={`badge ${STATUS[it.status].cls}`}>{STATUS[it.status].label}</span>
                    <Link href={`/mv/${it.mv_id}/video`} className="min-w-0 flex-1 truncate font-semibold hover:text-cherry">
                      {m ? `#${m.idea_id} · ${m.title}` : `${it.mv_id} (đã xoá)`}
                    </Link>
                    {it.status === "done" && it.output && (
                      <a className="btn-mint btn-sm" href={mediaUrl(it.mv_id, it.output, true)} download>
                        ⬇ Tải MP4
                      </a>
                    )}
                    {(it.status === "error" || it.status === "skipped" || it.status === "cancelled") && (
                      <button className="btn-ghost btn-sm" disabled={busy} onClick={() => act({ action: "retry", id: it.id })}>
                        ↻ Dựng lại
                      </button>
                    )}
                    {it.status !== "running" && (
                      <button className="btn-ghost btn-sm" disabled={busy} onClick={() => act({ action: "remove", id: it.id })} aria-label="Xoá khỏi hàng chờ">
                        ✕
                      </button>
                    )}
                  </div>
                  {job && (
                    <div className="mt-1.5 pl-8">
                      <div className="flex items-center gap-2 text-xs text-muted">
                        {job.stage}
                        <span className="ml-auto font-semibold text-ink">{Math.round(job.progress * 100)}%</span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-cream-dark">
                        <div className="h-full bg-cherry transition-all" style={{ width: `${job.progress * 100}%` }} />
                      </div>
                    </div>
                  )}
                  {it.message && it.status !== "running" && <p className="mt-1 pl-8 text-xs text-muted">{it.message}</p>}
                  {it.status === "done" && it.started_at && it.finished_at && (
                    <p className="mt-1 pl-8 text-xs text-muted">
                      Dựng trong {Math.round((Date.parse(it.finished_at) - Date.parse(it.started_at)) / 1000)} giây · file trong <code>data/media/{it.mv_id}/</code>
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </div>
  );
}
