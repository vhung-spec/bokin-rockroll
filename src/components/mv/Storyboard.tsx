"use client";

import { useState } from "react";
import { CopyButton, ErrorBox, Field, Modal, Spinner } from "@/components/ui";
import { api } from "@/lib/client";
import { formatTime } from "@/lib/structure";
import type { Issue, MVResult, Shot } from "@/lib/types";

const SECTION_COLORS = ["bg-mint/40", "bg-cream-dark", "bg-amber-100", "bg-cherry/10", "bg-sky-100", "bg-violet-100", "bg-lime-100", "bg-rose-100", "bg-chrome"];

const QUICK_REQUESTS = ["Góc máy khác", "Nhiều chuyển động hơn", "Lãng mạn hơn", "Bối cảnh phụ khác", "Ngắn gọn hơn"];

interface Props {
  mv: MVResult;
  maxChars: number;
  onUpdated: (mv: MVResult) => void;
}

export default function Storyboard({ mv, maxChars, onUpdated }: Props) {
  const [editing, setEditing] = useState<Shot | null>(null);
  const [regen, setRegen] = useState<Shot | null>(null);
  const [busyShot, setBusyShot] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sections = [...new Set(mv.shots.map((s) => s.section))];

  async function regenerate(shotNo: number, instruction: string) {
    setBusyShot(shotNo);
    setError(null);
    setRegen(null);
    try {
      onUpdated(await api<MVResult>(`/api/mv/${mv.id}/shot`, { method: "POST", json: { shot_no: shotNo, instruction } }));
    } catch (e) {
      setError(`Cảnh #${shotNo}: ${(e as Error).message}`);
    } finally {
      setBusyShot(null);
    }
  }

  return (
    <div>
      <ErrorBox error={error} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-ink text-left text-xs uppercase text-muted">
              <th className="w-10 p-2">#</th>
              <th className="w-32 p-2">Đoạn · thời gian</th>
              <th className="w-72 p-2">Mô tả (VI)</th>
              <th className="p-2">Prompt (EN)</th>
              <th className="w-36 p-2"></th>
            </tr>
          </thead>
          <tbody>
            {mv.shots.map((s) => {
              const issues = mv.issues.filter((i) => i.shot_no === s.shot_no && i.severity !== "info");
              const color = SECTION_COLORS[sections.indexOf(s.section) % SECTION_COLORS.length];
              const over = s.prompt_en.length > maxChars;
              return (
                <tr key={s.shot_no} id={`shot-${s.shot_no}`} className="border-b border-ink/15 align-top target:bg-amber-50">
                  <td className="p-2 text-lg font-bold text-cherry">{s.shot_no}</td>
                  <td className="p-2">
                    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-semibold ${color}`}>{s.section}</span>
                    <div className="mt-1 font-mono text-xs">
                      {formatTime(s.start_sec)}–{formatTime(s.start_sec + s.duration_sec)}
                    </div>
                    <div className="text-xs text-muted">{s.duration_sec}s</div>
                  </td>
                  <td className="p-2">
                    <p>{s.description_vi}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <span className="badge">{s.shot_size}</span>
                      <span className="badge">🎥 {s.camera}</span>
                      {s.is_motion && <span className="badge border-cherry/40 bg-cherry/10">💃 chuyển động</span>}
                      {s.signature_shot && <span className="badge border-mint-dark/50 bg-mint/30">★ {s.signature_shot}</span>}
                      {s.edited && <span className="badge border-amber-500 bg-amber-100">✎ đã sửa tay</span>}
                    </div>
                    {s.lyric_line && <p className="mt-1 text-xs italic text-muted">♪ “{s.lyric_line}”</p>}
                  </td>
                  <td className="p-2">
                    <p className="prompt-text">{s.prompt_en}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span className={over ? "font-semibold text-cherry" : ""}>
                        {s.prompt_en.length}/{maxChars} ký tự
                      </span>
                      <span>· chuyển cảnh: {s.transition_to_next}</span>
                    </div>
                    <details className="mt-1 text-xs">
                      <summary className="cursor-pointer text-muted">Negative prompt</summary>
                      <p className="prompt-text mt-1 text-muted">{s.negative_prompt}</p>
                    </details>
                    {issues.length > 0 && <ShotIssues issues={issues} />}
                  </td>
                  <td className="p-2">
                    <div className="flex flex-col gap-1.5">
                      <CopyButton text={s.prompt_en} label="Copy prompt" className="btn-mint btn-sm" />
                      <button className="btn-ghost btn-sm" disabled={busyShot !== null} onClick={() => setRegen(s)}>
                        {busyShot === s.shot_no ? <Spinner /> : "↻"} Sinh lại cảnh này
                      </button>
                      <button className="btn-ghost btn-sm" onClick={() => setEditing(s)}>
                        ✎ Sửa tay
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {regen && <RegenModal shot={regen} onClose={() => setRegen(null)} onSubmit={(text) => regenerate(regen.shot_no, text)} />}
      {editing && (
        <ShotEditor
          mv={mv}
          shot={editing}
          maxChars={maxChars}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            onUpdated(updated);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function ShotIssues({ issues }: { issues: Issue[] }) {
  return (
    <ul className="mt-1 space-y-0.5">
      {issues.map((i, k) => (
        <li key={k} className={`text-xs ${i.severity === "error" ? "text-cherry" : "text-amber-800"}`}>
          {i.severity === "error" ? "⛔" : "⚠️"} {i.message_vi}
        </li>
      ))}
    </ul>
  );
}

function RegenModal({ shot, onClose, onSubmit }: { shot: Shot; onClose: () => void; onSubmit: (instruction: string) => void }) {
  const [text, setText] = useState("");
  return (
    <Modal open title={`Sinh lại cảnh #${shot.shot_no} (${shot.section})`} onClose={onClose}>
      <p className="mb-2 text-sm text-muted">Hiện tại: {shot.description_vi}</p>
      <Field label="Yêu cầu thêm (không bắt buộc)">
        <textarea className="input min-h-20" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ví dụ: đổi sang cảnh trong xe mui trần, góc máy thấp" />
      </Field>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {QUICK_REQUESTS.map((q) => (
          <button key={q} className="badge hover:bg-cream-dark" onClick={() => setText((t) => (t ? `${t}; ${q.toLowerCase()}` : q))}>
            {q}
          </button>
        ))}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>
          Huỷ
        </button>
        <button className="btn-primary" onClick={() => onSubmit(text.trim())}>
          ↻ Sinh lại
        </button>
      </div>
    </Modal>
  );
}

function ShotEditor({
  mv,
  shot,
  maxChars,
  onClose,
  onSaved,
}: {
  mv: MVResult;
  shot: Shot;
  maxChars: number;
  onClose: () => void;
  onSaved: (mv: MVResult) => void;
}) {
  const [form, setForm] = useState({
    prompt_en: shot.prompt_en,
    description_vi: shot.description_vi,
    camera: shot.camera,
    shot_size: shot.shot_size,
    negative_prompt: shot.negative_prompt,
    transition_to_next: shot.transition_to_next,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(patch: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      onSaved(await api<MVResult>(`/api/mv/${mv.id}/shot`, { method: "PATCH", json: { shot_no: shot.shot_no, patch } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const missingStyle = !form.prompt_en.includes(mv.style_text);
  return (
    <Modal open wide title={`Sửa tay cảnh #${shot.shot_no} (${shot.section})`} onClose={onClose}>
      <div className="space-y-3">
        <Field
          label={`Prompt (EN) — ${form.prompt_en.length}/${maxChars} ký tự`}
          hint={missingStyle ? "⚠️ Prompt không còn style preset ở cuối." : "Giữ nguyên mô tả nhân vật để nhân vật nhất quán giữa các clip."}
        >
          <textarea className="input prompt-text min-h-48" value={form.prompt_en} onChange={set("prompt_en")} />
        </Field>
        <Field label="Mô tả (VI)">
          <textarea className="input min-h-16" value={form.description_vi} onChange={set("description_vi")} />
        </Field>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Cỡ cảnh">
            <input className="input" value={form.shot_size} onChange={set("shot_size")} />
          </Field>
          <Field label="Máy quay">
            <input className="input" value={form.camera} onChange={set("camera")} />
          </Field>
          <Field label="Chuyển cảnh">
            <input className="input" value={form.transition_to_next} onChange={set("transition_to_next")} />
          </Field>
        </div>
        <Field label="Negative prompt">
          <textarea className="input min-h-16" value={form.negative_prompt} onChange={set("negative_prompt")} />
        </Field>
        <ErrorBox error={error} />
        <div className="flex flex-wrap justify-end gap-2">
          {shot.edited && (
            <button className="btn-ghost mr-auto" disabled={busy} onClick={() => submit({ resetEdit: true })} title="Ghép lại prompt từ bản gốc + Character Bible + style">
              Khôi phục bản tự động
            </button>
          )}
          <button className="btn-ghost" onClick={onClose}>
            Huỷ
          </button>
          <button className="btn-primary" disabled={busy || !form.prompt_en.trim()} onClick={() => submit(form)}>
            {busy && <Spinner />} Lưu
          </button>
        </div>
      </div>
    </Modal>
  );
}
