"use client";

import { Card } from "@/components/ui";
import type { Engine } from "@/lib/types";

const OPTIONS: { value: Engine; title: string; desc: string; tag?: string }[] = [
  {
    value: "auto",
    title: "Tự động",
    desc: "Có API key → gọi Claude API. Chưa có key → dùng claude.ai (copy – dán).",
    tag: "Khuyên dùng",
  },
  {
    value: "manual",
    title: "claude.ai (copy – dán)",
    desc: "Dùng tài khoản claude.ai của bạn: app tạo sẵn yêu cầu, bạn copy sang claude.ai rồi dán câu trả lời lại. Không tốn phí API.",
    tag: "Không cần API key",
  },
  {
    value: "api",
    title: "Claude API",
    desc: "Tự động hoàn toàn, chạy batch 50 bài một lần. Cần API key và trả phí theo token.",
  },
  {
    value: "demo",
    title: "Demo",
    desc: "Ghép từ mẫu có sẵn, không dùng AI — chỉ để thử giao diện.",
  },
];

export default function EngineCard({ engine, hasKey, onChange }: { engine: Engine; hasKey: boolean; onChange: (e: Engine) => void }) {
  const effective = engine === "auto" ? (hasKey ? "Claude API" : "claude.ai (copy – dán)") : null;
  return (
    <Card title="Cách tạo nội dung" className="lg:col-span-2">
      <div className="grid gap-3 md:grid-cols-4">
        {OPTIONS.map((o) => (
          <label
            key={o.value}
            className={`cursor-pointer rounded-xl border-2 p-3 transition ${engine === o.value ? "border-cherry bg-cherry/5" : "border-ink/20 hover:border-ink/50"}`}
          >
            <div className="flex items-center gap-2">
              <input type="radio" name="engine" checked={engine === o.value} onChange={() => onChange(o.value)} />
              <span className="font-semibold">{o.title}</span>
            </div>
            {o.tag && <span className="badge mt-1 border-mint-dark/50 bg-mint/30">{o.tag}</span>}
            <p className="mt-1 text-xs text-muted">{o.desc}</p>
          </label>
        ))}
      </div>
      {effective && <p className="mt-2 text-sm">Hiện đang dùng: <b>{effective}</b>.</p>}
      {engine === "api" && !hasKey && <p className="mt-2 text-sm text-cherry">Chưa có API key — hãy nhập ở mục “API key” bên dưới.</p>}
    </Card>
  );
}
