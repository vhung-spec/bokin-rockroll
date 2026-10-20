"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MODE_LABEL, useStatus } from "@/lib/useStatus";

const LINKS = [
  { href: "/", label: "Nhập ý tưởng" },
  { href: "/batch", label: "Chạy batch" },
  { href: "/manual", label: "claude.ai" },
  { href: "/history", label: "Lịch sử" },
  { href: "/pipeline", label: "Tự động" },
  { href: "/muse", label: "Clip Muse" },
  { href: "/render-queue", label: "Hàng chờ dựng" },
  { href: "/library", label: "Thư viện" },
  { href: "/settings", label: "Cài đặt" },
];

const MODE_STYLE = {
  claude: "border-mint/60 bg-mint/15 text-mint",
  manual: "border-sky-300/70 bg-sky-300/15 text-sky-200",
  mock: "border-amber-300/70 bg-amber-300/15 text-amber-200",
};

export default function Nav() {
  const pathname = usePathname();
  const { status } = useStatus([pathname]);

  return (
    <header className="border-b-4 border-cherry bg-ink text-cream">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="font-display text-2xl text-mint">MV Prompt Studio</span>
          <span className="hidden text-xs uppercase tracking-[0.2em] text-cream/70 sm:inline">Rock &amp; Roll · Doo-Wop · 1950s</span>
        </Link>
        <nav className="flex flex-wrap gap-1">
          {LINKS.map((l) => {
            const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            const count =
              l.href === "/manual"
                ? (status?.pendingDrafts ?? 0)
                : l.href === "/render-queue"
                  ? (status?.renderQueue ?? 0)
                  : l.href === "/muse"
                    ? (status?.museOpen ?? 0)
                    : l.href === "/pipeline"
                      ? (status?.pipelineOpen ?? 0)
                      : 0;
            if (l.href === "/manual" && status && status.mode !== "manual" && !count) return null;
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-full px-3 py-1 text-sm font-semibold transition ${active ? "bg-cherry text-white" : "text-cream/90 hover:bg-white/10"}`}
              >
                {l.label}
                {count > 0 && <span className="ml-1.5 rounded-full bg-amber-300 px-1.5 text-xs text-ink">{count}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto text-xs">
          {status && (
            <Link href="/settings" className={`badge ${MODE_STYLE[status.mode]}`} title="Đổi chế độ trong Cài đặt">
              {MODE_LABEL[status.mode]}
              {status.mode === "claude" && <> · {status.model}</>} → {status.videoModelName}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
