"use client";

import { useState } from "react";
import { Card, CopyButton, ErrorBox, Spinner } from "@/components/ui";
import { api } from "@/lib/client";
import type { Character, MVResult } from "@/lib/types";

function fileUrl(p: string) {
  return `/api/files/${p.replace(/^data\/uploads\//, "")}`;
}

export default function BibleCard({ mv, onUpdated }: { mv: MVResult; onUpdated: (mv: MVResult) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Character[]>(mv.character_bible.characters);
  const [saveSeries, setSaveSeries] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const bibleText = mv.character_bible.characters.map((c) => `${c.id}: ${c.description}`).join("\n");

  async function save() {
    setBusy("save");
    setError(null);
    try {
      const updated = await api<MVResult>(`/api/mv/${mv.id}`, {
        method: "PATCH",
        json: { action: "bible", characters: draft, saveAsSeriesCouple: saveSeries },
      });
      onUpdated(updated);
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function upload(characterId: string, files: FileList | null) {
    if (!files?.length) return;
    setBusy(`up:${characterId}`);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("mvId", mv.id);
      fd.set("characterId", characterId);
      for (const f of Array.from(files)) fd.append("files", f);
      onUpdated(await api<MVResult>("/api/upload", { method: "POST", body: fd }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function removeImage(characterId: string, file: string) {
    try {
      onUpdated(await api<MVResult>("/api/upload", { method: "DELETE", json: { mvId: mv.id, characterId, file } }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Card
      title="Character Bible"
      actions={
        editing ? (
          <>
            <button className="btn-ghost btn-sm" onClick={() => setEditing(false)}>
              Huỷ
            </button>
            <button className="btn-primary btn-sm" onClick={save} disabled={busy === "save"}>
              {busy === "save" && <Spinner />} Lưu & ghép lại prompt
            </button>
          </>
        ) : (
          <>
            <CopyButton text={bibleText} label="Copy bible" />
            <button
              className="btn-ghost btn-sm"
              onClick={() => {
                setDraft(mv.character_bible.characters);
                setEditing(true);
              }}
            >
              Sửa
            </button>
          </>
        )
      }
    >
      <p className="mb-3 text-xs text-muted">Mô tả nhân vật được chèn nguyên văn vào mọi prompt có nhân vật đó, để nhân vật nhất quán giữa các clip.</p>
      <div className="space-y-3">
        {(editing ? draft : mv.character_bible.characters).map((c, idx) => (
          <div key={idx} className="rounded-lg border border-ink/20 bg-cream/60 p-3">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              {editing ? (
                <>
                  <input
                    className="input w-28 font-bold uppercase"
                    value={c.id}
                    onChange={(e) => setDraft((d) => d.map((x, k) => (k === idx ? { ...x, id: e.target.value.toUpperCase() } : x)))}
                  />
                  <input
                    className="input w-48"
                    value={c.role}
                    onChange={(e) => setDraft((d) => d.map((x, k) => (k === idx ? { ...x, role: e.target.value } : x)))}
                  />
                  {idx >= 2 && (
                    <button className="btn-ghost btn-sm ml-auto" onClick={() => setDraft((d) => d.filter((_, k) => k !== idx))}>
                      Xoá
                    </button>
                  )}
                </>
              ) : (
                <>
                  <span className="rounded bg-cherry px-2 py-0.5 text-xs font-bold text-white">{c.id}</span>
                  <span className="text-xs text-muted">{c.role}</span>
                  <span className="ml-auto">
                    <CopyButton text={c.description} />
                  </span>
                </>
              )}
            </div>
            {editing ? (
              <textarea
                className="input min-h-20"
                value={c.description}
                onChange={(e) => setDraft((d) => d.map((x, k) => (k === idx ? { ...x, description: e.target.value } : x)))}
              />
            ) : (
              <p className="text-sm italic">{c.description}</p>
            )}
            {!editing && (
              <div className="mt-2">
                <div className="flex flex-wrap items-center gap-2">
                  {(c.reference_images ?? []).map((p) => (
                    <div key={p} className="group relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={fileUrl(p)} alt={`Ảnh tham chiếu ${c.id}`} className="h-16 w-16 rounded border border-ink/30 object-cover" title={p} />
                      <button
                        className="absolute -right-1.5 -top-1.5 hidden h-5 w-5 rounded-full bg-cherry text-xs text-white group-hover:block"
                        onClick={() => removeImage(c.id, p)}
                        title="Xoá ảnh"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <label className="btn-ghost btn-sm cursor-pointer">
                    {busy === `up:${c.id}` ? <Spinner /> : "＋"} Ảnh tham chiếu
                    <input type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" onChange={(e) => upload(c.id, e.target.files)} />
                  </label>
                </div>
                {(c.reference_images ?? []).length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-xs text-muted">
                    {c.reference_images!.map((p) => (
                      <li key={p} className="font-mono">
                        {p}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {editing && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            className="btn-ghost btn-sm"
            onClick={() => setDraft((d) => [...d, { id: `CHAR${d.length + 1}`, role: "supporting character", description: "" }])}
          >
            ＋ Thêm nhân vật phụ
          </button>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={saveSeries} onChange={(e) => setSaveSeries(e.target.checked)} />
            Lưu làm cặp đôi cố định cho series “{mv.idea.series || "mặc định"}”
          </label>
        </div>
      )}
      <div className="mt-3">
        <ErrorBox error={error} />
      </div>
    </Card>
  );
}
