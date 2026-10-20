"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MuseStatus, useMuse } from "@/components/muse/MusePanels";
import { Card, ErrorBox, Spinner } from "@/components/ui";
import { api, mediaUrl } from "@/lib/client";
import type { ParseResult } from "@/lib/parser";
import { STEP_LABEL, type PipelineItem, type PipelineView, type StepName, type StepStatus } from "@/lib/pipelineSteps";
import type { IdeaRow } from "@/lib/types";

interface Candidate {
  id: string;
  idea_id: string;
  title: string;
  series: string;
  shot_count: number;
  clip_count: number;
  audio: { name: string; duration: number } | null;
}

type View = PipelineView & {
  settings: { mode: "claude" | "mock" | "manual"; songDir: string; museMode: "gateway" | "haohao"; minShots: number; maxShots: number };
};

const CHIP: Record<StepStatus, string> = {
  pending: "border-ink/30 bg-cream text-muted",
  running: "border-sky-500 bg-sky-200 text-sky-950 animate-pulse",
  waiting: "border-amber-500 bg-amber-100 text-amber-900",
  done: "border-mint-dark/60 bg-mint/30",
  error: "border-cherry bg-cherry/10 text-cherry-dark",
};
const ICON: Record<StepStatus, string> = { pending: "·", running: "…", waiting: "⏸", done: "✓", error: "✗" };
const STEPS: StepName[] = ["script", "song", "clips", "render"];

/** Bước đang cần chú ý của một việc (lỗi > chờ > đang chạy). */
function focus(it: PipelineItem): { name: StepName; status: StepStatus; message?: string } | null {
  for (const want of ["error", "waiting", "running"] as StepStatus[]) {
    const name = STEPS.find((s) => it.steps[s].status === want);
    if (name) return { name, ...it.steps[name] };
  }
  return null;
}

export default function PipelinePage() {
  const [view, setView] = useState<View | null>(null);
  const [mvs, setMvs] = useState<Candidate[] | null>(null);
  const [tab, setTab] = useState<"ideas" | "mvs">("ideas");
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const muse = useMuse();

  const reload = useCallback(() => api<View>("/api/pipeline").then(setView, (e) => setError((e as Error).message)), []);
  const loadMvs = useCallback(() => api<{ mvs: Candidate[] }>("/api/render-queue").then((r) => setMvs(r.mvs), () => {}), []);
  useEffect(() => {
    void reload();
    void loadMvs();
  }, [reload, loadMvs]);
  const open = view?.items.some((i) => !i.done_at) ?? false;
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => void reload(), 4000);
    return () => clearInterval(t);
  }, [open, reload]);

  const busyMvs = useMemo(() => new Set((view?.items ?? []).filter((i) => !i.done_at && i.mv_id).map((i) => i.mv_id!)), [view]);

  async function run<T>(fn: () => Promise<T>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      return await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function parse() {
    await run(async () => setParsed(await api<ParseResult>("/api/parse", { method: "POST", json: { text } })));
  }

  async function start(payload: { ideas?: IdeaRow[]; mvIds?: string[] }) {
    const ideas = payload.ideas?.length ?? 0;
    const chosen = (mvs ?? []).filter((m) => payload.mvIds?.includes(m.id));
    const shots = chosen.reduce((n, m) => n + Math.max(0, m.shot_count - m.clip_count), 0);
    const cfg = view?.settings;
    const range = cfg ? (cfg.minShots === cfg.maxShots ? `${cfg.minShots}` : `${cfg.minShots}–${cfg.maxShots}`) : "15–20";
    const lines = [
      ideas ? (cfg?.mode === "mock" ? `• Chế độ Demo ghép ${ideas} kịch bản từ mẫu (không tốn phí).` : `• Claude viết ${ideas} kịch bản (khoảng 0,10–0,20 USD mỗi MV qua API).`) : "",
      ideas ? `• Mỗi MV mới ${range} cảnh = ${range} lượt Muse.` : "",
      chosen.length ? `• ${chosen.length} MV có sẵn: khoảng ${shots} cảnh thiếu clip = ${shots} lượt Muse.` : "",
      "• Đủ clip + có bài hát thì tự dựng MP4.",
    ].filter(Boolean);
    const muse = cfg?.museMode === "gateway" ? "Lượt Muse tính vào hạn mức tuần của tài khoản Meta." : "Đang dùng cách dán tay vào HaoHao: bước Clip Muse chờ bạn dán prompt ở trang Clip Muse.";
    if (!confirm(`Chạy tự động ${ideas + chosen.length} việc?\n\n${lines.join("\n")}\n\n${muse}`)) return;
    await run(async () => {
      const r = await api<PipelineView & { added: number }>("/api/pipeline", { method: "POST", json: { action: "add", ...payload } });
      setNotice(`Đã thêm ${r.added} việc vào dây chuyền.`);
      setParsed(null);
      setSelected(new Set());
      await reload();
    });
  }

  async function post(json: unknown) {
    await run(async () => {
      await api("/api/pipeline", { method: "POST", json });
      await reload();
    });
  }

  const s = view?.settings;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl uppercase">Tự động: ý tưởng → MP4</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Mỗi việc chạy qua 4 bước: <b>Kịch bản</b> (Claude viết) → <b>Bài hát</b> (tự tìm trong thư mục nhạc) → <b>Clip Muse</b> (tự gửi từng cảnh, clip xong tự
          vào đúng cảnh) → <b>Dựng MP4</b>. Tắt app giữa chừng không sao: mở lại là chạy tiếp.
        </p>
      </div>
      <ErrorBox error={error} />
      {notice && <p className="text-sm font-semibold text-mint-dark">{notice}</p>}

      <Card title="Chuẩn bị">
        {!s ? (
          <Spinner />
        ) : (
          <div className="space-y-2 text-sm">
            <p>
              <b>Kịch bản:</b>{" "}
              {s.mode === "claude" ? (
                <span className="text-mint-dark">✓ Claude API — tự viết</span>
              ) : s.mode === "mock" ? (
                <span className="text-amber-800">Chế độ Demo (ghép từ mẫu, không dùng AI)</span>
              ) : (
                <span className="text-cherry-dark">
                  ✗ Đang ở chế độ claude.ai (copy–dán) — chỉ chạy được MV có sẵn. Nhập API key ở{" "}
                  <Link href="/settings" className="underline">
                    Cài đặt
                  </Link>{" "}
                  để tự viết kịch bản.
                </span>
              )}
            </p>
            <p>
              <b>Bài hát:</b>{" "}
              {s.songDir ? (
                <span>
                  tự tìm trong <code>{s.songDir}</code>
                </span>
              ) : (
                <span className="text-amber-800">
                  chưa đặt “Thư mục nhạc” trong{" "}
                  <Link href="/settings" className="underline">
                    Cài đặt
                  </Link>{" "}
                  — MV nào chưa có bài sẽ chờ bạn tải bài lên.
                </span>
              )}
            </p>
            <div>
              <b>Muse:</b> {muse.view ? <MuseStatus view={muse.view} url={muse.url} onView={muse.setView} /> : <Spinner />}
            </div>
          </div>
        )}
      </Card>

      <Card
        title="1. Thêm việc"
        actions={
          <div className="flex gap-1">
            <button className={`btn-sm ${tab === "ideas" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("ideas")}>
              Từ ý tưởng
            </button>
            <button className={`btn-sm ${tab === "mvs" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("mvs")}>
              Từ MV có sẵn
            </button>
          </div>
        }
      >
        {tab === "ideas" ? (
          <div className="space-y-3">
            <p className="text-xs text-muted">
              Dán bảng ý tưởng như ở trang Nhập ý tưởng (mỗi dòng: id | địa điểm + năm | chủ đề | dàn ý | tên bài | …). Ghi đúng <b>tên bài</b> để app tự tìm bài
              hát trong thư mục nhạc; không ghi thời lượng thì app lấy độ dài của bài.
            </p>
            <textarea className="input min-h-28 font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} placeholder="1 | Santa Monica Pier Summer 1955 | T01 | Hai người gặp nhau bên vòng đu quay | Đèn Khuya" />
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn-ghost btn-sm" disabled={busy || !text.trim()} onClick={() => void parse()}>
                Đọc bảng
              </button>
              {parsed && (
                <button className="btn-primary" disabled={busy || !parsed.rows.length} onClick={() => void start({ ideas: parsed.rows })} data-testid="pipeline-start-ideas">
                  {busy && <Spinner />} ▶ Chạy tự động {parsed.rows.length} ý tưởng
                </button>
              )}
            </div>
            {parsed && (
              <div className="text-sm">
                {parsed.warnings.length > 0 && <ErrorBox error={parsed.warnings.join(" · ")} />}
                <ul className="mt-2 space-y-0.5">
                  {parsed.rows.map((r) => (
                    <li key={r.id}>
                      <b>#{r.id}</b> {r.song_title ? `“${r.song_title}” · ` : ""}
                      {r.world_location} · {r.theme_code}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : !mvs ? (
          <Spinner />
        ) : !mvs.length ? (
          <p className="text-sm text-muted">Chưa có MV nào.</p>
        ) : (
          <div className="space-y-3">
            <div className="max-h-[24rem] overflow-auto rounded-lg border border-ink/15">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-cream-dark text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="w-8 px-2 py-1.5"></th>
                    <th className="px-2 py-1.5">MV</th>
                    <th className="px-2 py-1.5">Clip</th>
                    <th className="px-2 py-1.5">Bài hát</th>
                  </tr>
                </thead>
                <tbody>
                  {mvs.map((m) => (
                    <tr key={m.id} className="border-t border-ink/10">
                      <td className="px-2 py-1.5">
                        <input
                          type="checkbox"
                          disabled={busyMvs.has(m.id)}
                          title={busyMvs.has(m.id) ? "Đang chạy trong dây chuyền" : ""}
                          checked={selected.has(m.id)}
                          onChange={() =>
                            setSelected((cur) => {
                              const next = new Set(cur);
                              if (next.has(m.id)) next.delete(m.id);
                              else next.add(m.id);
                              return next;
                            })
                          }
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <span className="font-semibold">
                          #{m.idea_id} · {m.title}
                        </span>
                        {m.series && <div className="text-xs text-muted">{m.series}</div>}
                      </td>
                      <td className="px-2 py-1.5">
                        {m.clip_count}/{m.shot_count}
                      </td>
                      <td className="px-2 py-1.5">{m.audio ? "✓" : <span className="text-muted">chưa có</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="btn-primary" disabled={busy || !selected.size} onClick={() => void start({ mvIds: [...selected] })} data-testid="pipeline-start-mvs">
              {busy && <Spinner />} ▶ Chạy tự động {selected.size} MV
            </button>
          </div>
        )}
      </Card>

      <Card
        title="2. Dây chuyền"
        actions={
          view?.items.some((i) => i.done_at) ? (
            <button className="btn-ghost btn-sm" disabled={busy} onClick={() => void post({ action: "clear" })}>
              Bỏ các việc đã xong
            </button>
          ) : undefined
        }
      >
        {!view ? (
          <Spinner />
        ) : !view.items.length ? (
          <p className="text-sm text-muted">Chưa có việc nào.</p>
        ) : (
          <div className="space-y-3">
            {view.error && <p className="text-xs text-cherry-dark">Lần chạy gần nhất: {view.error}</p>}
            {view.items.map((it) => {
              const f = focus(it);
              const hasError = STEPS.some((st) => it.steps[st].status === "error");
              return (
                <div key={it.id} className="rounded-lg border border-ink/15 p-3" data-testid={`pipeline-${it.id}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{it.title}</span>
                    {STEPS.map((st) => (
                      <span key={st} className={`badge ${CHIP[it.steps[st].status]}`} title={it.steps[st].message ?? ""} data-step={st} data-status={it.steps[st].status}>
                        {ICON[it.steps[st].status]} {STEP_LABEL[st]}
                      </span>
                    ))}
                    <span className="ml-auto flex flex-wrap gap-2 text-xs">
                      {it.mv_id && (
                        <Link href={`/mv/${it.mv_id}/video`} className="btn-ghost btn-sm">
                          Mở MV
                        </Link>
                      )}
                      {it.mv_id && it.output && (
                        <a className="btn-primary btn-sm" href={mediaUrl(it.mv_id, it.output, true)} download>
                          ⬇ Tải MP4
                        </a>
                      )}
                      {hasError && (
                        <button className="btn-ghost btn-sm" disabled={busy} onClick={() => void post({ action: "retry", id: it.id })}>
                          ↻ Thử lại bước lỗi
                        </button>
                      )}
                      <button className="btn-ghost btn-sm" disabled={busy} onClick={() => void post({ action: "remove", id: it.id })} title="Bỏ khỏi dây chuyền (không xoá MV, clip hay video)">
                        Bỏ
                      </button>
                    </span>
                  </div>
                  {it.done_at ? (
                    <p className="mt-1 text-xs font-semibold text-mint-dark">✓ Xong — {it.output}</p>
                  ) : (
                    f?.message && (
                      <p className={`mt-1 text-xs ${f.status === "error" ? "text-cherry-dark" : f.status === "waiting" ? "text-amber-800" : "text-muted"}`}>
                        {STEP_LABEL[f.name]}: {f.message}
                      </p>
                    )
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
