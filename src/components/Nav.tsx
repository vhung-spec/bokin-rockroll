"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const LINKS = [
  { href: "/", label: "Nhập ý tưởng" },
  { href: "/batch", label: "Chạy batch" },
  { href: "/history", label: "Lịch sử" },
  { href: "/library", label: "Thư viện" },
  { href: "/settings", label: "Cài đặt" },
];

interface Status {
  mode: "claude" | "mock";
  hasKey: boolean;
  model: string;
  videoModelName: string;
}

export default function Nav() {
  const pathname = usePathname();
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null));
  }, [pathname]);

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
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-full px-3 py-1 text-sm font-semibold transition ${
                  active ? "bg-cherry text-white" : "text-cream/90 hover:bg-white/10"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto text-xs">
          {status &&
            (status.mode === "claude" ? (
              <span className="badge border-mint/60 bg-mint/15 text-mint">
                Claude · {status.model} → {status.videoModelName}
              </span>
            ) : (
              <span className="badge border-amber-300/70 bg-amber-300/15 text-amber-200" title="Chưa có ANTHROPIC_API_KEY hoặc đang bật chế độ demo">
                Chế độ demo (không gọi API) → {status.videoModelName}
              </span>
            ))}
        </div>
      </div>
    </header>
  );
}
