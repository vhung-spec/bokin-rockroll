"use client";

import { Card } from "@/components/ui";
import { estimateCost, formatRange } from "@/lib/cost";
import type { Effort, ModelPrice, Pricing } from "@/lib/types";

const FIELDS: { key: keyof ModelPrice; label: string }[] = [
  { key: "input", label: "Vào" },
  { key: "output", label: "Ra" },
  { key: "cache_write", label: "Ghi cache" },
  { key: "cache_read", label: "Đọc cache" },
];

export default function PricingCard({
  pricing,
  onChange,
  model,
  effort,
  shots,
}: {
  pricing: Pricing;
  onChange: (p: Pricing) => void;
  model: string;
  effort: Effort;
  shots: number;
}) {
  const setPrice = (m: string, k: keyof ModelPrice, v: number) =>
    onChange({ ...pricing, models: { ...pricing.models, [m]: { ...pricing.models[m], [k]: v } } });
  const est = estimateCost(pricing.models[model], shots, effort);
  return (
    <Card title="Chi phí & tỷ giá" className="lg:col-span-2">
      <div className="mb-3 flex flex-wrap items-end gap-4">
        <label className="block">
          <span className="label">Tỷ giá (đ cho 1 USD)</span>
          <input
            className="input w-40"
            type="number"
            min={1}
            value={pricing.usd_to_vnd}
            onChange={(e) => onChange({ ...pricing, usd_to_vnd: Number(e.target.value) })}
          />
        </label>
        <p className="text-sm">
          {est ? (
            <>
              Ước tính mỗi MV ({shots} cảnh, {model}, effort {effort}): <b>{formatRange(est, pricing.usd_to_vnd)}</b>
            </>
          ) : (
            <span className="text-amber-800">Chưa có giá cho model “{model}” — thêm vào bảng dưới để tính chi phí.</span>
          )}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-muted">
              <th className="p-1">Model</th>
              {FIELDS.map((f) => (
                <th key={f.key} className="w-28 p-1">
                  {f.label} ($/1M token)
                </th>
              ))}
              <th className="w-10 p-1"></th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(pricing.models).map(([m, p]) => (
              <tr key={m} className={m === model ? "bg-mint/20" : ""}>
                <td className="p-1 font-mono text-xs">
                  {m}
                  {m === model && <span className="badge ml-2">đang dùng</span>}
                </td>
                {FIELDS.map((f) => (
                  <td key={f.key} className="p-1">
                    <input className="input" type="number" min={0} step="0.01" value={p[f.key]} onChange={(e) => setPrice(m, f.key, Number(e.target.value))} />
                  </td>
                ))}
                <td className="p-1">
                  <button
                    className="btn-ghost btn-sm"
                    onClick={() => {
                      const next = { ...pricing.models };
                      delete next[m];
                      onChange({ ...pricing, models: next });
                    }}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        className="btn-ghost btn-sm mt-2"
        onClick={() => {
          const name = window.prompt("Tên model (ví dụ claude-opus-5)", model)?.trim();
          if (!name || pricing.models[name]) return;
          onChange({ ...pricing, models: { ...pricing.models, [name]: { input: 0, output: 0, cache_write: 0, cache_read: 0 } } });
        }}
      >
        ＋ Thêm model
      </button>
      <p className="mt-2 text-xs text-muted">
        Chi phí mỗi MV được tính từ số token thật mà Claude API báo về và lưu lại cùng MV. Giá có thể thay đổi — kiểm tra tại{" "}
        <a className="underline" href="https://platform.claude.com/pricing" target="_blank" rel="noreferrer">
          platform.claude.com/pricing
        </a>
        . Chi phí render clip trên công cụ video (Veo, Kling…) không tính ở đây.
      </p>
    </Card>
  );
}
