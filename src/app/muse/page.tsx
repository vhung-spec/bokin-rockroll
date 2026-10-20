"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MuseShots, MuseStatus, PasteBox, confirmSend, useMuse } from "@/components/muse/MusePanels";
import { Card, ErrorBox, Spinner } from "@/components/ui";
import { api } from "@/lib/client";
import { museCounts } from "@/lib/muse";
import type { MuseView, SendResult } from "@/lib/museJobs";

interface Candidate {
  id: string;
  idea_id: string;
  title: string;
  series: string;
  shot_count: number;
  clip_count: number;
  audio: { name: string; duration: number } | null;
}

export default function MusePage() {
  const { view, setView, error, setError, url } = useMuse();
  const gateway = view?.mode === "gateway";
  const [mvs, setMvs] = useState<Candidate[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [search, setSearch] = useState("");
  const [result, setResult] = useState<SendResult | null>(null);
  const [busy, setBusy] = useState(false);

  const loadMvs = () =>
    api<{ mvs: Candidate[] }>("/api/render-queue").then(
      (r) => setMvs(r.mvs),
      (e) => setError((e as Error).message),
    );
  useEffect(() => {
    void loadMvs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Có clip mới vào MV → cập nhật số clip trong bảng.
  const doneTotal = view?.mvs.reduce((n, m) => n + museCounts(m).done, 0) ?? 0;
  useEffect(() => {
    if (doneTotal) void loadMvs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneTotal]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (mvs ?? []).filter((m) => !q || `${m.idea_id} ${m.title} ${m.series}`.toLowerCase().includes(q));
  }, [mvs, search]);
  const tracking = new Map((view?.mvs ?? []).map((m) => [m.mv_id, m]));

  async function send() {
    const ids = [...selected];
    const shots = (mvs ?? []).filter((m) => selected.has(m.id)).reduce((n, m) => n + (onlyMissing ? Math.max(0, m.shot_count - m.clip_count) : m.shot_count), 0);
    if (!confirmSend(view, shots)) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<SendResult & { view: MuseView }>("/api/muse", { method: "POST", json: { action: "send", ids, onlyMissing } });
      setResult(r);
      setView(r.view);
      setSelected(new Set());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function post(json: unknown) {
    setBusy(true);
    setError(null);
    try {
      setView(await api<MuseView>("/api/muse", { method: "POST", json }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function resend(mvId: string, shots: number[]) {
    if (!confirmSend(view, shots.length, true)) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<SendResult & { view: MuseView }>("/api/muse", { method: "POST", json: { action: "send", ids: [mvId], shots } });
      setResult(r);
      setView(r.view);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl uppercase">Tạo clip bằng Muse</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          {gateway ? (
            <>
              Muse (Meta) làm clip qua <b>Cổng Muse</b> chạy trên máy này. Chọn MV → app <b>tự gửi</b> từng cảnh (kèm ảnh nhân vật nếu có).
            </>
          ) : (
            <>
              Muse (Meta) làm clip qua tool <b>HaoHao</b>. Chọn MV → app copy sẵn prompt của các cảnh → bạn dán vào HaoHao <b>một lần</b>.
            </>
          )}{" "}
          Clip nào Muse làm xong, app tự đưa vào đúng cảnh của đúng MV; MV đủ clip và có bài hát thì tự vào hàng chờ dựng. Tắt app giữa chừng không sao: mở lại
          app là nhận tiếp.
        </p>
      </div>
      <ErrorBox error={error} />

      <Card title={gateway ? "Cổng Muse" : "HaoHao"}>{view ? <MuseStatus view={view} url={url} onView={setView} /> : <Spinner />}</Card>

      <Card
        title="1. Chọn MV"
        actions={
          <>
            <button className="btn-ghost btn-sm" onClick={() => setSelected(new Set(visible.filter((m) => m.clip_count < m.shot_count).map((m) => m.id)))}>
              Chọn MV còn thiếu clip
            </button>
            {selected.size > 0 && (
              <button className="btn-ghost btn-sm" onClick={() => setSelected(new Set())}>
                Bỏ chọn
              </button>
            )}
          </>
        }
      >
        <input className="input mb-3 max-w-xs" placeholder="Tìm theo tên bài, mã, series…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {!mvs ? (
          <Spinner />
        ) : !mvs.length ? (
          <p className="text-sm text-muted">
            Chưa có MV nào.{" "}
            <Link href="/" className="text-cherry underline">
              Tạo MV
            </Link>{" "}
            trước.
          </p>
        ) : (
          <div className="max-h-[28rem] overflow-auto rounded-lg border border-ink/15">
            <table className="w-full text-sm" data-testid="muse-mv-table">
              <thead className="sticky top-0 bg-cream-dark text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="w-8 px-2 py-1.5"></th>
                  <th className="px-2 py-1.5">MV</th>
                  <th className="px-2 py-1.5">Clip</th>
                  <th className="px-2 py-1.5">Bài hát</th>
                  <th className="px-2 py-1.5">Muse</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((m) => {
                  const t = tracking.get(m.id);
                  const c = t ? museCounts(t) : null;
                  return (
                    <tr key={m.id} className="border-t border-ink/10">
                      <td className="px-2 py-1.5">
                        <input
                          type="checkbox"
                          checked={selected.has(m.id)}
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
                        <Link href={`/mv/${m.id}/video`} className="font-semibold text-ink hover:text-cherry">
                          #{m.idea_id} · {m.title}
                        </Link>
                        {m.series && <div className="text-xs text-muted">{m.series}</div>}
                      </td>
                      <td className="px-2 py-1.5">
                        <span className={m.clip_count >= m.shot_count ? "text-mint-dark" : ""}>
                          {m.clip_count}/{m.shot_count}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">{m.audio ? "✓" : <span className="text-muted">chưa có</span>}</td>
                      <td className="px-2 py-1.5 text-xs">
                        {c ? (
                          <>
                            {c.done}/{c.total} xong{c.error > 0 && <span className="text-cherry-dark"> · {c.error} lỗi</span>}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
            Chỉ cảnh chưa có clip
          </label>
          <button className="btn-primary" disabled={!selected.size || busy} onClick={() => void send()} data-testid="muse-send">
            {busy && <Spinner />} 🎬 {gateway ? "Gửi sang Muse" : "Tạo clip bằng Muse"} ({selected.size} MV)
          </button>
          <span className="text-xs text-muted">
            {gateway ? "Mỗi cảnh gửi đi" : "Mỗi prompt dán vào HaoHao"} là một lượt Muse (tính vào hạn mức tuần của tài khoản Meta).
          </span>
        </div>
        {result && (
          <div className="mt-3">
            <PasteBox result={result} onClose={() => setResult(null)} />
          </div>
        )}
      </Card>

      <Card
        title="2. Tiến độ"
        actions={
          view?.mvs.length ? (
            <button className="btn-ghost btn-sm" disabled={busy} onClick={() => void post({ action: "check" })}>
              ↻ Dò ngay
            </button>
          ) : undefined
        }
      >
        {!view ? (
          <Spinner />
        ) : !view.mvs.length ? (
          <p className="text-sm text-muted">Chưa có MV nào đang tạo clip bằng Muse.</p>
        ) : (
          <div className="space-y-4">
            {view.mvs.map((m) => (
              <div key={m.mv_id} className="rounded-lg border border-ink/15 p-3">
                <MuseShots
                  mv={m}
                  busy={busy}
                  showTitle
                  onResend={(s) => void resend(m.mv_id, s)}
                  onReimport={(s) => void post({ action: "reimport", id: m.mv_id, shots: s })}
                  onRecheck={(s) => void post({ action: "recheck", id: m.mv_id, shots: s })}
                  onForget={() => void post({ action: "forget", id: m.mv_id })}
                />
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
