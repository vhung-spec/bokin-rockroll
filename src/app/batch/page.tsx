"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useReducer, useState } from "react";
import { Card, ErrorBox, IssueBadge, Spinner } from "@/components/ui";
import type { BatchItem } from "@/lib/batch";
import { batchEngine } from "@/lib/batchEngine";
import { api, copyText, exportUrl } from "@/lib/client";
import { formatMoney } from "@/lib/cost";

interface Status {
  mode: "claude" | "mock" | "manual";
  concurrency: number;
  usdToVnd: number;
}

const STATUS_LABEL: Record<BatchItem["status"], string> = {
  pending: "Chờ",
  running: "Đang chạy",
  done: "Xong",
  error: "Lỗi",
};
const STATUS_STYLE: Record<BatchItem["status"], string> = {
  pending: "bg-chrome text-ink",
  running: "bg-amber-200 text-amber-900",
  done: "bg-mint text-ink",
  error: "bg-cherry text-white",
};

export default function BatchPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Đang tải…</p>}>
      <BatchRunner />
    </Suspense>
  );
}

function BatchRunner() {
  const router = useRouter();
  const params = useSearchParams();
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const [status, setStatus] = useState<Status | null>(null);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [ready, setReady] = useState(false);
  const engine = batchEngine;

  useEffect(() => {
    engine.ensureLoaded();
    setReady(true);
    const unsub = engine.subscribe(rerender);
    engine.onFinish = (b) => {
      const done = b.items.filter((i) => i.status === "done");
      if (b.openWhenDone && b.items.length === 1 && done[0]?.mvId) router.push(`/mv/${done[0].mvId}`);
    };
    const autostart = params.get("autostart") === "1";
    let cancelled = false;
    api<Status>("/api/status")
      .then((s) => {
        if (cancelled) return;
        setStatus(s);
        engine.concurrency = Math.max(1, s.concurrency);
        if (autostart) {
          router.replace("/batch");
          if (engine.batch?.items.some((i) => i.status === "pending")) engine.start();
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      engine.onFinish = null;
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!ready) return null;
  const batch = engine.batch;
  const running = engine.running;

  if (!batch) {
    return (
      <Card title="Chưa có batch">
        <p className="text-sm">
          Hãy vào <Link href="/" className="font-semibold text-cherry underline">Nhập ý tưởng</Link> để dán bảng hoặc upload file, rồi bấm “Chạy batch”.
        </p>
      </Card>
    );
  }

  const total = batch.items.length;
  const done = batch.items.filter((i) => i.status === "done");
  const failed = batch.items.filter((i) => i.status === "error");
  const inflight = batch.items.filter((i) => i.status === "running");
  const pending = batch.items.filter((i) => i.status === "pending");
  const pct = Math.round(((done.length + failed.length) / Math.max(1, total)) * 100);
  const doneIds = done.map((i) => i.mvId!).filter(Boolean);

  const pause = () => engine.pause();
  const stop = () => engine.stop();
  const start = () => engine.start();
  const retryFailed = () => {
    engine.setPending((i) => i.status === "error");
    start();
  };
  const retryOne = (key: string) => {
    engine.setPending((i) => i.key === key);
    if (!engine.running) start();
  };
  const clear = () => {
    if (engine.inflight) return;
    if (!window.confirm("Xoá batch này khỏi trình duyệt? (Các MV đã sinh vẫn còn trong Lịch sử.)")) return;
    engine.replace(null);
  };
  const copyAll = async () => {
    const res = await fetch(exportUrl("prompts", { ids: doneIds }));
    const text = await res.text();
    const ok = res.ok && (await copyText(text));
    setCopyMsg(ok ? `Đã copy ${text.split("\n").length} prompt.` : "Không copy được.");
    setTimeout(() => setCopyMsg(null), 2500);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-3xl uppercase">Chạy batch</h1>
          <p className="text-sm text-muted">
            {total} MV · song song tối đa {status?.concurrency ?? "…"} · {status ? { mock: "chế độ demo", manual: "claude.ai", claude: "Claude API" }[status.mode] : "…"} · giọng: {{ default: "mặc định", playful: "vui tươi", melancholy: "buồn", cinematic: "điện ảnh" }[batch.tone]}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {running ? (
            <>
              <button className="btn-ghost" onClick={pause} title="Không gửi thêm yêu cầu mới; các MV đang chạy sẽ chạy nốt">
                ⏸ Tạm dừng
              </button>
              <button className="btn-ghost" onClick={stop} title="Huỷ cả các MV đang chạy (đưa về hàng chờ)">
                ⏹ Dừng ngay
              </button>
            </>
          ) : (
            <button className="btn-primary" onClick={start} disabled={!pending.length}>
              ▶ {done.length || failed.length ? "Chạy tiếp" : "Bắt đầu"}
            </button>
          )}
          {failed.length > 0 && (
            <button className="btn-ghost" onClick={retryFailed}>
              ↻ Thử lại {failed.length} mục lỗi
            </button>
          )}
          <button className="btn-ghost" onClick={clear} disabled={inflight.length > 0}>
            Xoá batch
          </button>
        </div>
      </div>

      <Card>
        <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
          <span className="font-semibold">{pct}%</span>
          <span className="text-muted">
            Xong {done.length} · Lỗi {failed.length} · Đang chạy {inflight.length} · Chờ {pending.length}
          </span>
          {done.some((i) => i.cost_usd) && (
            <span className="ml-auto font-semibold">
              Chi phí Claude API: {formatMoney(done.reduce((a, i) => a + (i.cost_usd ?? 0), 0), status?.usdToVnd ?? 26000)}
            </span>
          )}
          {running && <Spinner />}
        </div>
        <div className="h-4 overflow-hidden rounded-full border-2 border-ink bg-cream">
          <div className="h-full bg-[repeating-linear-gradient(45deg,#c8102e_0_12px,#e0334f_12px_24px)] transition-all" style={{ width: `${pct}%` }} />
        </div>
      </Card>

      {doneIds.length > 0 && (
        <Card title={`Xuất ${doneIds.length} MV đã xong`}>
          <div className="flex flex-wrap items-center gap-2">
            <a className="btn-primary" href={exportUrl("xlsx", { ids: doneIds })}>
              XLSX (mỗi MV một sheet)
            </a>
            <a className="btn-ghost" href={exportUrl("csv", { ids: doneIds })}>
              CSV
            </a>
            <a className="btn-ghost" href={exportUrl("md", { ids: doneIds })}>
              Markdown
            </a>
            <a className="btn-ghost" href={exportUrl("txt", { ids: doneIds })}>
              TXT
            </a>
            <a className="btn-ghost" href={exportUrl("json", { ids: doneIds })}>
              JSON
            </a>
            <a className="btn-mint" href={exportUrl("prompts-spaced", { ids: doneIds })} title="File .txt chỉ gồm các prompt, mỗi prompt cách nhau một dòng trống">
              File prompt (.txt, cách 1 dòng)
            </a>
            <button className="btn-mint" onClick={copyAll}>
              Copy tất cả prompt
            </button>
            {copyMsg && <span className="text-sm text-mint-dark">{copyMsg}</span>}
          </div>
        </Card>
      )}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-ink text-left text-xs uppercase text-muted">
                <th className="p-2">ID</th>
                <th className="p-2">Bối cảnh</th>
                <th className="p-2">Chủ đề</th>
                <th className="p-2">Trạng thái</th>
                <th className="p-2">Kết quả</th>
              </tr>
            </thead>
            <tbody>
              {batch.items.map((item) => (
                <tr key={item.key} className="border-b border-ink/15 align-top">
                  <td className="p-2 font-semibold">{item.idea.id}</td>
                  <td className="p-2">
                    {item.idea.song_title && <div className="font-semibold">{item.idea.song_title}</div>}
                    <div>{item.idea.world_location}</div>
                  </td>
                  <td className="p-2">
                    {item.idea.theme_code} <span className="text-muted">{item.idea.theme_name}</span>
                  </td>
                  <td className="p-2">
                    <span className={`badge border-ink/30 ${STATUS_STYLE[item.status]}`}>
                      {item.status === "running" && <Spinner />} {STATUS_LABEL[item.status]}
                    </span>
                    {item.status === "running" && item.started_at && (
                      <span className="ml-2 text-xs text-muted">{Math.round((now - item.started_at) / 1000)}s</span>
                    )}
                    {item.status === "done" && item.started_at && item.finished_at && (
                      <span className="ml-2 text-xs text-muted">{Math.round((item.finished_at - item.started_at) / 1000)}s</span>
                    )}
                  </td>
                  <td className="p-2">
                    {item.status === "done" && item.mvId && (
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/mv/${item.mvId}`} className="btn-mint btn-sm">
                          Mở storyboard ({item.shots} cảnh)
                        </Link>
                        <IssueBadge severity="error" count={item.errors ?? 0} />
                        <IssueBadge severity="warning" count={item.warnings ?? 0} />
                        {item.cost_usd ? <span className="text-xs text-muted">{formatMoney(item.cost_usd, status?.usdToVnd ?? 26000)}</span> : null}
                      </div>
                    )}
                    {item.status === "done" && item.draft && (
                      <Link href="/manual" className="btn-mint btn-sm">
                        Làm tiếp ở trang claude.ai →
                      </Link>
                    )}
                    {item.status === "error" && (
                      <div className="space-y-1">
                        <ErrorBox error={item.error ?? "Lỗi không rõ"} />
                        <button className="btn-ghost btn-sm" onClick={() => retryOne(item.key)}>
                          ↻ Thử lại
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
