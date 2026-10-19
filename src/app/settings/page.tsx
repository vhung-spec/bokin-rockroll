"use client";

import { useEffect, useState } from "react";
import ApiKeyCard from "@/components/settings/ApiKeyCard";
import EngineCard from "@/components/settings/EngineCard";
import PricingCard from "@/components/settings/PricingCard";
import { Card, ErrorBox, Field, Spinner } from "@/components/ui";
import { api } from "@/lib/client";
import type { Character, Pricing, Settings, StyleLibrary, VideoModelLibrary } from "@/lib/types";

type Couples = Record<string, { characters: Character[]; created_at: string }>;

interface Status {
  hasKey: boolean;
  mode: "claude" | "mock" | "manual";
}

const MODEL_SUGGESTIONS = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"];

export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [styles, setStyles] = useState<StyleLibrary>({});
  const [models, setModels] = useState<VideoModelLibrary>({});
  const [couples, setCouples] = useState<Couples>({});
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Settings>("/api/settings").then(setS).catch((e) => setError(e.message));
    api<StyleLibrary>("/api/library/styles").then(setStyles).catch(() => {});
    api<VideoModelLibrary>("/api/library/videoModels").then(setModels).catch(() => {});
    api<Couples>("/api/couples").then(setCouples).catch(() => {});
    api<Pricing>("/api/library/pricing").then(setPricing).catch(() => {});
    api<Status>("/api/status").then(setStatus).catch(() => {});
  }, []);

  if (!s)
    return error ? (
      <ErrorBox error={error} />
    ) : (
      <p className="text-sm text-muted">
        <Spinner /> Đang tải…
      </p>
    );

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((prev) => (prev ? { ...prev, [k]: v } : prev));
  const profile = models[s.videoModel];
  const ratioSum = s.songStructure.reduce((a, b) => a + (Number(b.ratio) || 0), 0);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      setS(await api<Settings>("/api/settings", { method: "PUT", json: s }));
      await api("/api/couples", { method: "PUT", json: couples });
      if (pricing) setPricing(await api<Pricing>("/api/library/pricing", { method: "PUT", json: pricing }));
      setSaved("Đã lưu cài đặt.");
      setTimeout(() => setSaved(null), 2500);
      api<Status>("/api/status").then(setStatus).catch(() => {});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const updateSection = (i: number, patch: Partial<Settings["songStructure"][number]>) =>
    set(
      "songStructure",
      s.songStructure.map((x, k) => (k === i ? { ...x, ...patch } : x)),
    );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-3xl uppercase">Cài đặt</h1>
          <p className="text-sm text-muted">Lưu trong data/settings.json.</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {saved && <span className="text-sm text-mint-dark">{saved}</span>}
          <button className="btn-primary" onClick={save} disabled={busy}>
            {busy && <Spinner />} Lưu cài đặt
          </button>
        </div>
      </div>
      <ErrorBox error={error} />

      <div className="grid gap-5 lg:grid-cols-2">
        <EngineCard engine={s.engine} hasKey={Boolean(status?.hasKey)} onChange={(e) => set("engine", e)} />
        <ApiKeyCard onChanged={() => api<Status>("/api/status").then(setStatus).catch(() => {})} />
        <Card title="Claude API — model">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Model" hint="Mặc định claude-sonnet-5-5.">
              <input className="input" list="model-suggestions" value={s.model} onChange={(e) => set("model", e.target.value)} />
              <datalist id="model-suggestions">
                {MODEL_SUGGESTIONS.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </Field>
            <Field label="Mức effort" hint="Cao hơn = kỹ hơn nhưng chậm và tốn token hơn.">
              <select className="input" value={s.effort} onChange={(e) => set("effort", e.target.value as Settings["effort"])}>
                {["low", "medium", "high", "xhigh", "max"].map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Số MV chạy song song" hint="Giảm nếu gặp lỗi rate limit.">
              <input className="input" type="number" min={1} max={8} value={s.concurrency} onChange={(e) => set("concurrency", Number(e.target.value))} />
            </Field>
            <div className="pt-5">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={s.useFallback} onChange={(e) => set("useFallback", e.target.checked)} />
                Tự chuyển model dự phòng khi bị từ chối (server-side fallback)
              </label>
            </div>
          </div>
        </Card>
        <Card title="Công cụ video & storyboard">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Công cụ tạo video">
              <select className="input" value={s.videoModel} onChange={(e) => set("videoModel", e.target.value)}>
                {Object.entries(models).map(([k, m]) => (
                  <option key={k} value={k}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Độ dài clip (giây)" hint={profile ? `Để trống = mặc định ${profile.default_clip_len}s của ${profile.name} (hỗ trợ ${profile.clip_lengths.join("/")}s)` : undefined}>
              <input
                className="input"
                type="number"
                min={3}
                max={30}
                value={s.clipLen ?? ""}
                placeholder={profile ? String(profile.default_clip_len) : ""}
                onChange={(e) => set("clipLen", e.target.value ? Number(e.target.value) : null)}
              />
            </Field>
            <Field label="Số cảnh mỗi MV (tối thiểu – tối đa)" hint="Số cảnh = số prompt. Bài dài hơn sẽ dùng lại các cảnh khi dựng.">
              <div className="flex items-center gap-2">
                <input className="input" type="number" min={1} max={200} value={s.minShots} onChange={(e) => set("minShots", Number(e.target.value))} />
                <span>–</span>
                <input className="input" type="number" min={1} max={200} value={s.maxShots} onChange={(e) => set("maxShots", Number(e.target.value))} />
              </div>
            </Field>
            <Field label="Thời lượng mặc định (giây)">
              <input className="input" type="number" min={10} max={1200} value={s.defaultDuration} onChange={(e) => set("defaultDuration", Number(e.target.value))} />
            </Field>
            <Field label="Style preset mặc định">
              <select className="input" value={s.stylePreset} onChange={(e) => set("stylePreset", e.target.value)}>
                {Object.entries(styles).map(([k, st]) => (
                  <option key={k} value={k}>
                    {st.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="pt-5">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={s.allowVehicleMakes} onChange={(e) => set("allowVehicleMakes", e.target.checked)} />
                Cho phép tên hãng/đời xe (vd. 1954 Chevrolet Bel Air)
              </label>
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={s.loopScenes} onChange={(e) => set("loopScenes", e.target.checked)} />
                Cảnh sẽ được lặp lại khi dựng (mỗi cảnh độc lập, dùng lại được)
              </label>
            </div>
          </div>
          {profile && (
            <p className="mt-3 text-xs text-muted">
              {profile.name}: tối đa {profile.max_prompt_chars} ký tự/prompt · {profile.supports_audio ? "có mô tả âm thanh (Audio:)" : "không có âm thanh"} ·{" "}
              {profile.prompt_style}
            </p>
          )}
        </Card>

        <Card title="Cặp đôi cố định cho cả series" className="lg:col-span-2">
          <label className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={s.fixedCouple} onChange={(e) => set("fixedCouple", e.target.checked)} />
            Dùng chung một cặp đôi cho mọi MV trong cùng series
          </label>
          <p className="mb-3 text-xs text-muted">
            Bật lên: MV đầu tiên của mỗi series sẽ tạo cặp đôi (HE/SHE) và lưu lại; các MV sau dùng nguyên văn. Tắt: mỗi MV có cặp đôi riêng. Có thể sửa trực tiếp ở
            đây hoặc từ trang kết quả (“Lưu làm cặp đôi cố định”).
          </p>
          {Object.keys(couples).length === 0 && <p className="text-sm text-muted">Chưa có cặp đôi nào được lưu.</p>}
          <div className="space-y-3">
            {Object.entries(couples).map(([key, c]) => (
              <div key={key} className="rounded-lg border border-ink/20 bg-cream/60 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="font-semibold">{key === "__default__" ? "(MV không có series)" : key}</span>
                  <button
                    className="btn-ghost btn-sm ml-auto"
                    onClick={() =>
                      setCouples((all) => {
                        const n = { ...all };
                        delete n[key];
                        return n;
                      })
                    }
                  >
                    Xoá
                  </button>
                </div>
                {c.characters.map((ch, i) => (
                  <div key={i} className="mb-2 flex gap-2">
                    <span className="mt-1.5 w-12 shrink-0 text-xs font-bold text-cherry">{ch.id}</span>
                    <textarea
                      className="input min-h-14"
                      value={ch.description}
                      onChange={(e) =>
                        setCouples((all) => ({
                          ...all,
                          [key]: { ...all[key], characters: all[key].characters.map((x, k) => (k === i ? { ...x, description: e.target.value } : x)) },
                        }))
                      }
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Card>

        <Card title="Cấu trúc bài hát (tỉ lệ thời lượng)" className="lg:col-span-2">
          <p className="mb-2 text-xs text-muted">
            Tổng tỉ lệ hiện tại: <b className={ratioSum === 100 ? "text-mint-dark" : "text-amber-700"}>{ratioSum}%</b> (được chuẩn hoá tự động nếu khác 100). Số cảnh =
            ceil(thời lượng / độ dài clip); nhịp fast dùng clip ngắn hơn ở các đoạn chorus.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-muted">
                  <th className="p-1">Đoạn</th>
                  <th className="w-20 p-1">%</th>
                  <th className="p-1">Vai trò (VI)</th>
                  <th className="p-1">Vai trò (EN, gửi cho Claude)</th>
                  <th className="w-10 p-1"></th>
                </tr>
              </thead>
              <tbody>
                {s.songStructure.map((sec, i) => (
                  <tr key={i}>
                    <td className="p-1">
                      <input className="input" value={sec.name} onChange={(e) => updateSection(i, { name: e.target.value })} />
                    </td>
                    <td className="p-1">
                      <input className="input" type="number" min={0} value={sec.ratio} onChange={(e) => updateSection(i, { ratio: Number(e.target.value) })} />
                    </td>
                    <td className="p-1">
                      <input className="input" value={sec.role_vi} onChange={(e) => updateSection(i, { role_vi: e.target.value })} />
                    </td>
                    <td className="p-1">
                      <input className="input" value={sec.role_en} onChange={(e) => updateSection(i, { role_en: e.target.value })} />
                    </td>
                    <td className="p-1">
                      <button className="btn-ghost btn-sm" onClick={() => set("songStructure", s.songStructure.filter((_, k) => k !== i))}>
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
            onClick={() => set("songStructure", [...s.songStructure, { name: "Interlude", ratio: 5, role_vi: "", role_en: "" }])}
          >
            ＋ Thêm đoạn
          </button>
        </Card>

        {pricing && <PricingCard pricing={pricing} onChange={setPricing} model={s.model} effort={s.effort} shots={s.maxShots} />}

        <Card title="Giọng văn kênh (mô tả YouTube)" className="lg:col-span-2">
          <textarea className="input min-h-20" value={s.channelVoice} onChange={(e) => set("channelVoice", e.target.value)} />
        </Card>
      </div>
    </div>
  );
}
