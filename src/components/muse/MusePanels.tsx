"use client";

// Các khối giao diện "Tạo clip bằng Muse" dùng chung cho trang Clip Muse và trang Ghép video của từng MV.

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CopyButton, ErrorBox, Spinner } from "@/components/ui";
import { api, copyText } from "@/lib/client";
import type { HaoHaoInfo } from "@/lib/haohao";
import { MUSE_STATUS_LABEL, museCounts, pasteText, type MuseMV, type MuseShotStatus } from "@/lib/muse";
import type { MuseView, SendResult } from "@/lib/museJobs";

const CHIP: Record<MuseShotStatus, string> = {
  waiting: "border-amber-500 bg-amber-100 text-amber-900",
  queued: "border-sky-400 bg-sky-100 text-sky-900",
  running: "border-sky-500 bg-sky-200 text-sky-950 animate-pulse",
  done: "border-mint-dark/60 bg-mint/30",
  error: "border-cherry bg-cherry/10 text-cherry-dark",
  kept: "border-ink/30 bg-chrome/40",
};

/** Tiến độ Muse (?mv=… cho một MV), tự tải lại vài giây một lần khi còn cảnh đang làm. */
export function useMuse(mvId?: string) {
  const [view, setView] = useState<MuseView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const url = mvId ? `/api/muse?mv=${encodeURIComponent(mvId)}` : "/api/muse";
  const reload = useCallback(() => api<MuseView>(url).then(setView, (e) => setError((e as Error).message)), [url]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const open = view?.mvs.some((m) => m.shots.some((s) => s.status !== "done" && s.status !== "kept")) ?? false;
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => void reload(), 4000);
    return () => clearInterval(t);
  }, [open, reload]);
  return { view, setView, error, setError, reload };
}

export function HaoHaoStatus({ view }: { view: MuseView }) {
  const h: HaoHaoInfo = view.haohao;
  const onC = h.outputDir && /^c:/i.test(h.outputDir);
  return (
    <div className="space-y-1 text-sm">
      {h.found && !h.error ? (
        <p>
          <span className="badge border-mint-dark/50 bg-mint/30">✓ Đã thấy HaoHao</span> <span className="text-muted">{h.dir}</span> · {h.tasks} task video
        </p>
      ) : (
        <p className="text-cherry-dark">
          ✗ {h.error ?? "Chưa thấy HaoHao."} Cài và mở HaoHao một lần, hoặc chỉnh đường dẫn ở{" "}
          <Link href="/settings" className="underline">
            Cài đặt
          </Link>
          .
        </p>
      )}
      {h.outputDir && (
        <p className="text-xs text-muted">
          HaoHao lưu video ở: {h.outputDir}
          {h.outputIsDefault && " (mặc định)"}
          {onC && <span className="text-amber-800"> — ổ C gần đầy: nên đổi “Thư mục lưu” trong Cài đặt của HaoHao sang ổ D.</span>}
        </p>
      )}
      {view.error && h.found && <p className="text-xs text-cherry-dark">Lần dò gần nhất: {view.error}</p>}
      <p className="text-xs text-muted">
        Đủ clip + có bài hát → {view.autoRender ? "tự thêm vào hàng chờ dựng và chạy" : "không tự dựng"} · Negative prompt{" "}
        {view.avoid ? "ghép vào cuối prompt (Avoid: …)" : "không gửi"} ·{" "}
        <Link href="/settings" className="underline">
          đổi trong Cài đặt
        </Link>
      </p>
    </div>
  );
}

/** Sau khi bấm "Tạo clip bằng Muse": chữ đã copy + các bước dán vào HaoHao. */
export function PasteBox({ result, onClose }: { result: SendResult; onClose: () => void }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const once = useRef(false);
  useEffect(() => {
    if (once.current || !result.text) return;
    once.current = true;
    copyText(result.text).then(setCopied);
  }, [result.text]);

  function download() {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([result.text], { type: "text/plain;charset=utf-8" }));
    a.download = "prompt-muse.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="rounded-lg border-2 border-mint-dark/60 bg-mint/15 p-3 text-sm" data-testid="muse-paste">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <b>
          {result.count
            ? `${result.count} prompt cần dán vào HaoHao (${result.count} lượt Muse)`
            : "Không cần dán gì — mọi cảnh đã có sẵn video bên HaoHao."}
        </b>
        {result.reused > 0 && <span className="badge border-mint-dark/50 bg-mint/30">{result.reused} cảnh nhận luôn video có sẵn, không tốn lượt</span>}
        <button className="btn-ghost btn-sm ml-auto" onClick={onClose}>
          Đóng
        </button>
      </div>
      <ErrorBox error={result.warning ?? null} />
      {result.count > 0 && (
        <>
          <ol className="mb-2 list-decimal space-y-0.5 pl-5">
            <li>{copied ? "✓ Đã copy sẵn các prompt." : "Bấm Copy bên dưới."}</li>
            <li>
              Mở <b>HaoHao</b> → tab <b>Studio</b> → chọn <b>Video</b> và tỉ lệ <b>16:9</b>.
            </li>
            <li>Dán vào ô prompt (mỗi prompt cách nhau một dòng trống = một video) → bấm tạo.</li>
            <li>Xong. Clip nào Muse làm xong, app tự đưa vào đúng cảnh — không cần tải về hay chọn tay.</li>
          </ol>
          <textarea className="input min-h-28 font-mono text-xs" readOnly value={result.text} onFocus={(e) => e.target.select()} />
          <div className="mt-2 flex flex-wrap gap-2">
            <CopyButton text={result.text} label="📋 Copy prompt" className="btn-primary btn-sm" />
            <button className="btn-ghost btn-sm" onClick={download}>
              ⬇ Tải file .txt
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Các cảnh của một MV đang tạo bằng Muse: mỗi cảnh một ô màu theo trạng thái. */
export function MuseShots({
  mv,
  busy,
  onResend,
  onForget,
  showTitle,
}: {
  mv: MuseMV;
  busy?: boolean;
  onResend: (shots: number[]) => void;
  onForget: () => void;
  showTitle?: boolean;
}) {
  const c = museCounts(mv);
  const errors = mv.shots.filter((s) => s.status === "error").map((s) => s.shot_no);
  const waitingText = pasteText([...new Set(mv.shots.filter((s) => s.status === "waiting").map((s) => s.text))]);
  const pct = c.total ? Math.round((c.done / c.total) * 100) : 0;
  return (
    <div className="space-y-2" data-testid={`muse-mv-${mv.mv_id}`}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {showTitle && (
          <Link href={`/mv/${mv.mv_id}/video`} className="font-semibold text-ink hover:text-cherry">
            {mv.title}
          </Link>
        )}
        <span className="text-muted">
          {c.done}/{c.total} cảnh xong
          {c.active > 0 && ` · ${c.active} đang làm`}
          {c.waiting > 0 && ` · ${c.waiting} chờ dán`}
          {c.error > 0 && <span className="text-cherry-dark"> · {c.error} lỗi</span>}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          {waitingText && <CopyButton text={waitingText} label={`📋 Copy lại ${c.waiting} prompt chờ dán`} />}
          {errors.length > 0 && (
            <button className="btn-ghost btn-sm" disabled={busy} onClick={() => onResend(errors)} title="Tạo lại các cảnh lỗi (tốn thêm lượt Muse). Hoặc bấm Thử lại ngay trong HaoHao.">
              ↻ Gửi lại {errors.length} cảnh lỗi
            </button>
          )}
          <button className="btn-ghost btn-sm" disabled={busy} onClick={onForget} title="Thôi theo dõi (không xoá clip đã có, không đụng tới HaoHao)">
            Bỏ theo dõi
          </button>
        </div>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-cream-dark">
        <div className="h-full bg-mint-dark transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex flex-wrap gap-1">
        {mv.shots.map((s) => (
          <span
            key={s.shot_no}
            className={`badge ${CHIP[s.status]}`}
            title={[MUSE_STATUS_LABEL[s.status], s.step, s.message].filter(Boolean).join(" — ")}
            data-status={s.status}
          >
            #{s.shot_no} {s.status === "done" ? "✓" : s.status === "error" ? "✗" : s.status === "kept" ? "•" : (s.step ?? MUSE_STATUS_LABEL[s.status])}
          </span>
        ))}
      </div>
      {mv.shots.some((s) => s.message && s.status !== "done") && (
        <ul className="space-y-0.5 text-xs">
          {mv.shots
            .filter((s) => s.message && s.status !== "done")
            .map((s) => (
              <li key={s.shot_no} className={s.status === "error" ? "text-cherry-dark" : "text-muted"}>
                #{s.shot_no}: {s.message}
              </li>
            ))}
        </ul>
      )}
      {mv.note && <p className="text-xs font-semibold text-mint-dark">{mv.note}</p>}
    </div>
  );
}

/** Thẻ "Tạo clip bằng Muse" trên trang Ghép video của một MV. `onClips` = có clip mới vào MV (tải lại danh sách clip). */
export function MuseCard({ mvId, missing, onClips }: { mvId: string; missing: number; onClips: () => void }) {
  const { view, setView, error, setError } = useMuse(mvId);
  const url = `/api/muse?mv=${encodeURIComponent(mvId)}`;
  const [result, setResult] = useState<SendResult | null>(null);
  const [busy, setBusy] = useState(false);
  const mv = view?.mvs[0];
  const done = mv?.shots.filter((s) => s.status === "done").length ?? 0;
  // Cảnh chưa có clip, trừ các cảnh Muse đang làm.
  const todo = Math.max(0, missing - (mv?.shots.filter((s) => s.status === "waiting" || s.status === "queued" || s.status === "running").length ?? 0));
  const lastDone = useRef<number | null>(null);
  useEffect(() => {
    if (lastDone.current !== null && done > lastDone.current) onClips();
    lastDone.current = done;
  }, [done, onClips]);

  async function send(shots?: number[]) {
    if (shots && !confirm(`Gửi lại ${shots.length} cảnh sang Muse? Mỗi cảnh tốn thêm một lượt Muse.`)) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<SendResult & { view: MuseView }>(url, { method: "POST", json: { action: "send", ids: [mvId], shots, onlyMissing: true } });
      setResult(r);
      setView(r.view);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function forget() {
    setBusy(true);
    try {
      setView(await api<MuseView>(url, { method: "POST", json: { action: "forget", id: mvId } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Tạo clip bằng Muse"
      actions={
        <>
          <button className="btn-primary btn-sm" disabled={busy || !todo} onClick={() => void send()} title={todo ? "" : "Mọi cảnh đã có clip hoặc đang được Muse làm"}>
            {busy && <Spinner />} 🎬 Tạo {todo} cảnh chưa có clip
          </button>
          <Link href="/muse" className="btn-ghost btn-sm">
            Nhiều MV một lượt
          </Link>
        </>
      }
    >
      <ErrorBox error={error} />
      {!view ? (
        <p className="text-sm text-muted">
          <Spinner /> Đang tải…
        </p>
      ) : (
        <div className="space-y-3">
          <HaoHaoStatus view={view} />
          {result && <PasteBox result={result} onClose={() => setResult(null)} />}
          {mv ? (
            <MuseShots mv={mv} busy={busy} onResend={(s) => void send(s)} onForget={() => void forget()} />
          ) : (
            <p className="text-sm text-muted">
              Muse (Meta) làm clip qua tool HaoHao: app copy sẵn prompt của các cảnh, bạn dán vào HaoHao một lần; clip nào xong tự vào đúng cảnh.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
