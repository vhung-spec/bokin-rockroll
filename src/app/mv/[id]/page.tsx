"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import BibleCard from "@/components/mv/BibleCard";
import Storyboard from "@/components/mv/Storyboard";
import { Card, CopyButton, ErrorBox, IssueBadge, IssueList, Spinner } from "@/components/ui";
import { api, exportUrl } from "@/lib/client";
import { allPrompts } from "@/lib/exporters";
import { formatTime } from "@/lib/structure";
import type { MVResult, StyleLibrary, Tone, VideoModelLibrary } from "@/lib/types";

const TONES: { value: Tone; label: string }[] = [
  { value: "playful", label: "Vui tươi hơn" },
  { value: "melancholy", label: "Buồn hơn" },
  { value: "cinematic", label: "Điện ảnh hơn" },
  { value: "default", label: "Giọng mặc định" },
];
const TONE_LABEL: Record<Tone, string> = { default: "mặc định", playful: "vui tươi", melancholy: "buồn", cinematic: "điện ảnh" };

export default function MVPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [mv, setMv] = useState<MVResult | null>(null);
  const [styles, setStyles] = useState<StyleLibrary>({});
  const [models, setModels] = useState<VideoModelLibrary>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tone, setTone] = useState<Tone>("playful");

  useEffect(() => {
    api<MVResult>(`/api/mv/${id}`).then(setMv).catch((e) => setError(e.message));
    api<StyleLibrary>("/api/library/styles").then(setStyles).catch(() => {});
    api<VideoModelLibrary>("/api/library/videoModels").then(setModels).catch(() => {});
  }, [id]);

  if (error && !mv) return <ErrorBox error={error} />;
  if (!mv)
    return (
      <p className="text-sm text-muted">
        <Spinner /> Đang tải…
      </p>
    );

  const profile = models[mv.video_model];
  const maxChars = profile?.max_prompt_chars ?? 2000;
  const errors = mv.issues.filter((i) => i.severity === "error").length;
  const warnings = mv.issues.filter((i) => i.severity === "warning").length;
  const title = mv.idea.song_title || mv.idea.world_location;

  const jump = (n: number) => {
    document.getElementById(`shot-${n}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    history.replaceState(null, "", `#shot-${n}`);
  };

  async function changeStyle(styleKey: string) {
    setBusy("style");
    try {
      setMv(await api<MVResult>(`/api/mv/${mv!.id}`, { method: "PATCH", json: { action: "style", styleKey } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function recheck() {
    setBusy("recheck");
    try {
      setMv(await api<MVResult>(`/api/mv/${mv!.id}`, { method: "PATCH", json: { action: "recheck" } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function regenerateAll() {
    setBusy("tone");
    setError(null);
    try {
      const fresh = await api<MVResult>("/api/generate", { method: "POST", json: { idea: mv!.idea, tone } });
      router.push(`/mv/${fresh.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  async function remove() {
    if (!window.confirm("Xoá MV này khỏi lịch sử?")) return;
    await api(`/api/mv/${mv!.id}`, { method: "DELETE" });
    router.push("/history");
  }

  return (
    <div className="space-y-5">
      {/* Tiêu đề */}
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-widest text-muted">
            MV #{mv.idea.id}
            {mv.idea.series && <> · {mv.idea.series}</>}
          </p>
          <h1 className="text-3xl uppercase">{title}</h1>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="badge">{mv.idea.world_location}</span>
            <span className="badge">năm {mv.year}</span>
            <span className="badge">
              {mv.theme_code} · {mv.theme.name}
            </span>
            {mv.location_key && (
              <span className={`badge ${mv.location.auto_generated ? "border-amber-500 bg-amber-100" : "border-mint-dark/50 bg-mint/30"}`}>
                📍 {mv.location_key}
                {mv.location.auto_generated && " (tự sinh)"}
              </span>
            )}
            <span className="badge">
              {mv.structure.total_shots} cảnh · {formatTime(mv.structure.duration_sec)} · clip {mv.structure.clip_len}s · {mv.structure.tempo}
            </span>
            <span className="badge">🎬 {profile?.name ?? mv.video_model}</span>
            {mv.tone !== "default" && <span className="badge">giọng {TONE_LABEL[mv.tone]}</span>}
            {mv.generator === "mock" ? (
              <span className="badge border-amber-500 bg-amber-100">chế độ demo</span>
            ) : (
              <span className="badge">{mv.model}</span>
            )}
            <IssueBadge severity="error" count={errors} />
            <IssueBadge severity="warning" count={warnings} />
          </div>
          <p className="mt-2 max-w-4xl text-sm text-muted">{mv.idea.outline}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex flex-wrap justify-end gap-2">
            <a className="btn-primary btn-sm" href={exportUrl("xlsx", { ids: [mv.id] })}>
              XLSX
            </a>
            <a className="btn-ghost btn-sm" href={exportUrl("csv", { ids: [mv.id] })}>
              CSV
            </a>
            <a className="btn-ghost btn-sm" href={exportUrl("md", { ids: [mv.id] })}>
              MD
            </a>
            <a className="btn-ghost btn-sm" href={exportUrl("txt", { ids: [mv.id] })}>
              TXT
            </a>
            <a className="btn-ghost btn-sm" href={exportUrl("json", { ids: [mv.id] })}>
              JSON
            </a>
            <a className="btn-mint btn-sm" href={exportUrl("prompts-spaced", { ids: [mv.id] })} title="File .txt chỉ gồm các prompt, mỗi prompt cách nhau một dòng trống">
              File prompt (.txt)
            </a>
            <CopyButton text={allPrompts([mv])} label="Copy tất cả prompt" className="btn-mint btn-sm" />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <select className="input w-auto py-1 text-xs" value={tone} onChange={(e) => setTone(e.target.value as Tone)}>
              {TONES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <button className="btn-ghost btn-sm" onClick={regenerateAll} disabled={busy !== null} title="Tạo một phiên bản MV mới (bản cũ vẫn giữ trong Lịch sử)">
              {busy === "tone" ? <Spinner /> : "↻"} Sinh lại toàn MV
            </button>
            <button className="btn-ghost btn-sm" onClick={recheck} disabled={busy !== null} title="Chạy lại era check và các quy tắc với thư viện hiện tại">
              {busy === "recheck" && <Spinner />} Kiểm tra lại
            </button>
            <button className="btn-ghost btn-sm" onClick={remove}>
              Xoá
            </button>
          </div>
        </div>
      </div>
      <ErrorBox error={error} />

      {/* Cảnh báo */}
      <Card title="Kiểm tra (era check, độ dài, nhịp dựng, trùng lặp)">
        <IssueList issues={mv.issues} onJump={jump} />
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <BibleCard mv={mv} onUpdated={setMv} />
        </div>
        <Card title="Style preset" actions={<CopyButton text={mv.style_text} />}>
          <p className="text-sm italic">{mv.style_text}</p>
          <label className="mt-3 block">
            <span className="label">Đổi style cho cả MV</span>
            <select className="input" value={mv.style_key} disabled={busy === "style"} onChange={(e) => changeStyle(e.target.value)}>
              {Object.entries(styles).map(([k, s]) => (
                <option key={k} value={k}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <p className="mt-2 text-xs text-muted">Style được nối vào cuối mọi prompt. Cảnh đã sửa tay sẽ không bị thay.</p>
        </Card>
      </div>

      <Card
        title={`Storyboard — ${mv.shots.length} cảnh`}
        actions={<CopyButton text={allPrompts([mv])} label="Copy tất cả prompt (mỗi dòng 1 prompt)" className="btn-mint btn-sm" />}
      >
        <Storyboard mv={mv} maxChars={maxChars} onUpdated={setMv} />
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Thumbnail (16:9)" actions={<CopyButton text={mv.thumbnail_prompt} />}>
          <p className="prompt-text">{mv.thumbnail_prompt}</p>
        </Card>
        <Card title="Gợi ý tiêu đề YouTube">
          <ol className="space-y-2">
            {mv.youtube_titles.map((t, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="font-bold text-cherry">{i + 1}.</span>
                <span className="flex-1">{t}</span>
                <CopyButton text={t} />
              </li>
            ))}
          </ol>
        </Card>
        <Card title="Mô tả YouTube" actions={<CopyButton text={mv.youtube_description} />}>
          <p className="whitespace-pre-line text-sm">{mv.youtube_description}</p>
        </Card>
        <Card title="Ghi chú dựng phim">
          <ul className="space-y-1.5 text-sm">
            {mv.editing_notes.map((n, i) => (
              <li key={i}>
                <span className="font-semibold">{n.section}:</span> {n.note_vi}
              </li>
            ))}
          </ul>
          {mv.structure.notes.length > 0 && (
            <ul className="mt-3 space-y-1 border-t border-ink/15 pt-2 text-xs text-muted">
              {mv.structure.notes.map((n, i) => (
                <li key={i}>• {n}</li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Mạch truyện" className="lg:col-span-2">
          <ol className="grid gap-2 md:grid-cols-3">
            {mv.story_arc.map((b, i) => (
              <li key={i} className="rounded-lg border border-ink/15 bg-cream/60 p-2 text-sm">
                <div className="text-xs font-semibold uppercase text-cherry">{b.section}</div>
                {b.beat_vi}
              </li>
            ))}
          </ol>
        </Card>
      </div>

      {mv.duplicates.length > 0 && (
        <Card title="Trùng lặp trong series">
          <ul className="space-y-2 text-sm">
            {mv.duplicates.map((d) => (
              <li key={d.other_mv_id}>
                <Link href={`/mv/${d.other_mv_id}`} className="font-semibold text-cherry underline">
                  {d.other_title}
                </Link>{" "}
                — {d.similar_pairs.length} cảnh giống ({Math.round(d.ratio * 100)}%):{" "}
                {d.similar_pairs.slice(0, 8).map((p) => (
                  <button key={p.shot_no} className="badge mr-1 hover:bg-cream-dark" onClick={() => jump(p.shot_no)} title={p.shared.join(", ")}>
                    #{p.shot_no} ≈ #{p.other_shot_no}
                  </button>
                ))}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {mv.usage && mv.generator === "claude" && (
        <p className="text-right text-xs text-muted">
          Token: {mv.usage.input_tokens.toLocaleString()} vào · {mv.usage.output_tokens.toLocaleString()} ra
        </p>
      )}
    </div>
  );
}
