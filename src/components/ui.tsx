"use client";

import { useState, type ReactNode } from "react";
import { copyText } from "@/lib/client";
import type { Issue } from "@/lib/types";

export function CopyButton({ text, label = "Copy", className = "btn-ghost btn-sm" }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        }
      }}
    >
      {done ? "✓ Đã copy" : label}
    </button>
  );
}

export function Card({ title, actions, children, className = "" }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card p-4 ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {title && <h2 className="card-title">{title}</h2>}
          {actions && <div className="ml-auto flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Modal({ open, title, onClose, children, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/60 p-4" onMouseDown={onClose}>
      <div className={`card mt-10 w-full ${wide ? "max-w-4xl" : "max-w-2xl"} p-5`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center">
          <h2 className="card-title">{title}</h2>
          <button className="btn-ghost btn-sm ml-auto" onClick={onClose} aria-label="Đóng">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="rounded-lg border-2 border-cherry bg-cherry/10 px-3 py-2 text-sm text-cherry-dark">{error}</div>;
}

const SEVERITY_STYLE: Record<Issue["severity"], string> = {
  error: "border-cherry bg-cherry/10 text-cherry-dark",
  warning: "border-amber-500 bg-amber-100 text-amber-900",
  info: "border-mint-dark/50 bg-mint/20 text-ink",
};
const SEVERITY_LABEL: Record<Issue["severity"], string> = { error: "Lỗi", warning: "Cảnh báo", info: "Ghi chú" };

export function IssueBadge({ severity, count }: { severity: Issue["severity"]; count: number }) {
  if (!count) return null;
  return <span className={`badge ${SEVERITY_STYLE[severity]}`}>{count} {SEVERITY_LABEL[severity].toLowerCase()}</span>;
}

export function IssueList({ issues, onJump }: { issues: Issue[]; onJump?: (shotNo: number) => void }) {
  const [showInfo, setShowInfo] = useState(false);
  const visible = issues.filter((i) => i.severity !== "info" || showInfo);
  const infoCount = issues.filter((i) => i.severity === "info").length;
  if (!issues.length) return <p className="text-sm text-mint-dark">✓ Không phát hiện vấn đề nào.</p>;
  return (
    <div className="space-y-1.5">
      {visible.map((i, k) => (
        <div key={k} className={`flex items-start gap-2 rounded-md border px-2 py-1 text-sm ${SEVERITY_STYLE[i.severity]}`}>
          <span className="shrink-0 text-xs font-bold uppercase">{SEVERITY_LABEL[i.severity]}</span>
          {i.shot_no !== null && (
            <button className="shrink-0 font-semibold underline" onClick={() => onJump?.(i.shot_no!)}>
              #{i.shot_no}
            </button>
          )}
          <span>{i.message_vi}</span>
        </div>
      ))}
      {infoCount > 0 && (
        <button className="text-xs text-muted underline" onClick={() => setShowInfo((v) => !v)}>
          {showInfo ? "Ẩn ghi chú" : `Hiện ${infoCount} ghi chú`}
        </button>
      )}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Spinner() {
  return <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent align-[-2px]" />;
}

/**
 * Ô nhập giữ nguyên chữ người dùng gõ (không chuẩn hoá lại mỗi phím), chỉ báo giá trị lên trên.
 * Dùng cho các trường danh sách (mỗi dòng / phân cách dấu phẩy). Đổi `key` để nạp lại khi đổi mục.
 */
export function DraftField({
  value,
  onCommit,
  multiline,
  className = "input",
}: {
  value: string;
  onCommit: (text: string) => void;
  multiline?: boolean;
  className?: string;
}) {
  const [text, setText] = useState(value);
  const change = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setText(e.target.value);
    onCommit(e.target.value);
  };
  return multiline ? <textarea className={className} value={text} onChange={change} /> : <input className={className} value={text} onChange={change} />;
}
