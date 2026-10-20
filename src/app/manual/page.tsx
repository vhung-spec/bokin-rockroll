"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, ErrorBox, Spinner } from "@/components/ui";
import { api, copyText } from "@/lib/client";
import type { Draft, MVResult } from "@/lib/types";
import { useStatus } from "@/lib/useStatus";

type DraftRow = Omit<Draft, "ctx" | "notes"> & { ready: boolean };

interface Done {
  draftId: string;
  mv: MVResult;
}

export default function ManualPage() {
  const [drafts, setDrafts] = useState<DraftRow[] | null>(null);
  const [done, setDone] = useState<Done[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { status } = useStatus();

  const load = () =>
    api<DraftRow[]>("/api/drafts")
      .then(setDrafts)
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl uppercase">Làm với claude.ai</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Dùng tài khoản claude.ai của bạn thay cho API key — không tốn phí API. Mỗi MV làm 3 bước: copy yêu cầu → dán vào claude.ai → dán câu trả lời lại
          đây. App tự ghép Character Bible, style, kiểm tra niên đại và xuất file như bình thường.
        </p>
      </div>

      <Card title="Cách làm">
        <ol className="grid gap-3 text-sm md:grid-cols-3">
          <li className="rounded-lg border border-ink/15 bg-cream/60 p-3">
            <b className="text-cherry">1. Copy yêu cầu</b>
            <br />
            Bấm “Copy yêu cầu” ở MV cần làm. Yêu cầu đã có đủ bối cảnh, quy tắc niên đại và kế hoạch {status?.minShots ?? 15}–{status?.maxShots ?? 20} cảnh.
          </li>
          <li className="rounded-lg border border-ink/15 bg-cream/60 p-3">
            <b className="text-cherry">2. Dán vào claude.ai</b>
            <br />
            Mở{" "}
            <a className="underline" href="https://claude.ai/new" target="_blank" rel="noreferrer">
              một cuộc trò chuyện mới
            </a>
            , dán (Ctrl+V) rồi gửi. Claude trả về một khối <code>json</code>.
          </li>
          <li className="rounded-lg border border-ink/15 bg-cream/60 p-3">
            <b className="text-cherry">3. Dán câu trả lời lại đây</b>
            <br />
            Bấm nút copy của khối code trên claude.ai (hoặc chọn toàn bộ câu trả lời), dán vào ô bên dưới rồi bấm “Hoàn tất MV”.
          </li>
        </ol>
        <p className="mt-2 text-xs text-muted">
          Mẹo: mỗi MV dùng một cuộc trò chuyện mới. Nếu Claude dừng giữa chừng, gõ “Write the complete JSON again in one code block”. Gói claude.ai có giới
          hạn số tin nhắn — với nhiều bài, làm vài bài mỗi lần.
        </p>
      </Card>

      <ErrorBox error={error} />

      {done.length > 0 && (
        <Card title={`Đã xong ${done.length} MV`}>
          <ul className="space-y-1.5 text-sm">
            {done.map(({ mv }) => (
              <li key={mv.id} className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">#{mv.idea.id}</span> {mv.idea.song_title || mv.idea.world_location} · {mv.shots.length} cảnh
                <Link href={`/mv/${mv.id}`} className="btn-mint btn-sm">
                  Mở storyboard
                </Link>
                <a className="btn-ghost btn-sm" href={`/api/export?format=prompts-spaced&ids=${mv.id}`}>
                  File prompt (.txt)
                </a>
              </li>
            ))}
          </ul>
          {done.length > 1 && (
            <a className="btn-primary btn-sm mt-3" href={`/api/export?format=xlsx&ids=${done.map((d) => d.mv.id).join(",")}`}>
              XLSX {done.length} MV vừa xong
            </a>
          )}
        </Card>
      )}

      {!drafts && (
        <p className="text-sm text-muted">
          <Spinner /> Đang tải…
        </p>
      )}
      {drafts && drafts.length === 0 && (
        <Card>
          <p className="text-sm">
            Không có MV nào đang chờ. Vào{" "}
            <Link href="/" className="font-semibold text-cherry underline">
              Nhập ý tưởng
            </Link>{" "}
            để thêm bài{status?.mode !== "manual" ? " (và chọn chế độ “claude.ai (copy – dán)” trong Cài đặt)" : ""}.
          </p>
        </Card>
      )}

      {drafts?.map((d, i) => (
        <DraftCard
          key={d.id}
          index={i + 1}
          draft={d}
          onDone={(mv) => {
            setDone((x) => [...x, { draftId: d.id, mv }]);
            setDrafts((list) => list?.filter((x) => x.id !== d.id) ?? null);
          }}
          onDelete={() => setDrafts((list) => list?.filter((x) => x.id !== d.id) ?? null)}
        />
      ))}
    </div>
  );
}

function DraftCard({ draft, index, onDone, onDelete }: { draft: DraftRow; index: number; onDone: (mv: MVResult) => void; onDelete: () => void }) {
  const [copied, setCopied] = useState<{ chars: number; shots: number } | null>(null);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { idea } = draft;

  async function copyPrompt() {
    setBusy("copy");
    setError(null);
    try {
      const res = await api<{ prompt: string; chars: number; shots: number }>(`/api/drafts/${draft.id}/prompt`, { method: "POST" });
      if (!(await copyText(res.prompt))) throw new Error("Trình duyệt chặn copy — hãy thử lại.");
      setCopied({ chars: res.chars, shots: res.shots });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function finish() {
    setBusy("finish");
    setError(null);
    try {
      onDone(await api<MVResult>(`/api/drafts/${draft.id}/answer`, { method: "POST", json: { answer } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!window.confirm("Bỏ MV này khỏi danh sách chờ?")) return;
    await api(`/api/drafts/${draft.id}`, { method: "DELETE" });
    onDelete();
  }

  return (
    <Card
      title={
        <span>
          {index}. #{idea.id} {idea.song_title || idea.world_location}
          <span className="ml-2 text-xs font-normal normal-case text-muted">
            {idea.song_title && `${idea.world_location} · `}
            {idea.theme_code} {idea.theme_name}
          </span>
        </span>
      }
      actions={
        <button className="btn-ghost btn-sm" onClick={remove}>
          Bỏ
        </button>
      }
    >
      <p className="mb-3 text-sm text-muted">{idea.outline}</p>
      <div className="grid gap-4 md:grid-cols-[260px_1fr]">
        <div className="space-y-2">
          <button className="btn-mint w-full" onClick={copyPrompt} disabled={busy !== null}>
            {busy === "copy" ? <Spinner /> : "①"} Copy yêu cầu
          </button>
          <a className="btn-ghost w-full" href="https://claude.ai/new" target="_blank" rel="noreferrer">
            ② Mở claude.ai ↗
          </a>
          {copied ? (
            <p className="text-xs text-mint-dark">
              ✓ Đã copy {copied.chars.toLocaleString("vi-VN")} ký tự ({copied.shots} cảnh). Dán vào cuộc trò chuyện mới và gửi.
            </p>
          ) : (
            draft.ready && <p className="text-xs text-muted">Đã copy trước đó — có thể copy lại.</p>
          )}
        </div>
        <div>
          <textarea
            className="input prompt-text min-h-36"
            placeholder="③ Dán toàn bộ câu trả lời của Claude vào đây (khối ```json … ```)"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button className="btn-primary" onClick={finish} disabled={busy !== null || !answer.trim()}>
              {busy === "finish" && <Spinner />} Hoàn tất MV
            </button>
            {answer.trim() && <span className="text-xs text-muted">{answer.length.toLocaleString("vi-VN")} ký tự</span>}
          </div>
          <div className="mt-2">
            <ErrorBox error={error} />
          </div>
        </div>
      </div>
    </Card>
  );
}
