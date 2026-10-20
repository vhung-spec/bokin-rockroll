"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, DraftField, ErrorBox, Field, Spinner } from "@/components/ui";
import { api, lines } from "@/lib/client";
import type { EraRules, LocationData, LocationLibrary, StyleLibrary, Tempo, ThemeLibrary, VideoModelLibrary } from "@/lib/types";

type LibName = "themes" | "locations" | "eraRules" | "styles" | "videoModels";
type LibData = ThemeLibrary | LocationLibrary | EraRules | StyleLibrary | VideoModelLibrary;

const TABS: { key: LibName; label: string; file: string }[] = [
  { key: "themes", label: "Chủ đề", file: "themes.json" },
  { key: "locations", label: "Địa điểm", file: "locations.json" },
  { key: "eraRules", label: "Quy tắc niên đại", file: "era_rules.json" },
  { key: "styles", label: "Style preset", file: "style_presets.json" },
  { key: "videoModels", label: "Công cụ video", file: "video_models.json" },
];

const join = (xs?: string[]) => (xs ?? []).join("\n");

export default function LibraryPage() {
  const [tab, setTab] = useState<LibName>("themes");
  const [data, setData] = useState<LibData | null>(null);
  // Thư viện mà `data` đang chứa — tránh render editor mới với dữ liệu của tab cũ.
  const [dataTab, setDataTab] = useState<LibName | null>(null);
  const [raw, setRaw] = useState(false);
  const [rawText, setRawText] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setDirty(false);
    setError(null);
    api<LibData>(`/api/library/${tab}`)
      .then((d) => {
        setData(d);
        setDataTab(tab);
        setRawText(JSON.stringify(d, null, 2));
      })
      .catch((e) => setError(e.message));
  }, [tab]);

  function change(next: LibData) {
    setData(next);
    setRawText(JSON.stringify(next, null, 2));
    setDirty(true);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body = raw ? JSON.parse(rawText) : data;
      const res = await api<LibData>(`/api/library/${tab}`, { method: "PUT", json: body });
      setData(res);
      setRawText(JSON.stringify(res, null, 2));
      setDirty(false);
      setSaved("Đã lưu.");
      setTimeout(() => setSaved(null), 2000);
    } catch (e) {
      setError(e instanceof SyntaxError ? `JSON không hợp lệ: ${e.message}` : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const current = TABS.find((t) => t.key === tab)!;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-3xl uppercase">Thư viện</h1>
          <p className="text-sm text-muted">Chỉnh trực tiếp các file trong thư mục data/. Thay đổi áp dụng cho các lần sinh tiếp theo.</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {saved && <span className="text-sm text-mint-dark">{saved}</span>}
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={raw}
              onChange={(e) => {
                if (!e.target.checked) {
                  try {
                    setData(JSON.parse(rawText));
                  } catch {
                    setError("JSON không hợp lệ — sửa lại trước khi chuyển về chế độ form.");
                    return;
                  }
                }
                setRaw(e.target.checked);
              }}
            />
            Sửa JSON trực tiếp
          </label>
          <button className="btn-primary" onClick={save} disabled={busy || (!dirty && !raw)}>
            {busy && <Spinner />} Lưu {current.file}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`rounded-full border-2 border-ink px-3 py-1 text-sm font-semibold ${tab === t.key ? "bg-cherry text-white" : "bg-white hover:bg-cream-dark"}`}
            onClick={() => {
              if (dirty && !window.confirm("Có thay đổi chưa lưu. Bỏ qua?")) return;
              setTab(t.key);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <ErrorBox error={error} />

      {!data || dataTab !== tab ? (
        <p className="text-sm text-muted">
          <Spinner /> Đang tải…
        </p>
      ) : raw ? (
        <Card title={current.file}>
          <textarea
            className="input prompt-text min-h-[60vh]"
            value={rawText}
            onChange={(e) => {
              setRawText(e.target.value);
              setDirty(true);
            }}
          />
        </Card>
      ) : tab === "themes" ? (
        <ThemesEditor data={data as ThemeLibrary} onChange={change} />
      ) : tab === "locations" ? (
        <LocationsEditor data={data as LocationLibrary} onChange={change} />
      ) : tab === "eraRules" ? (
        <EraEditor data={data as EraRules} onChange={change} />
      ) : tab === "styles" ? (
        <StylesEditor data={data as StyleLibrary} onChange={change} />
      ) : (
        <VideoModelsEditor data={data as VideoModelLibrary} onChange={change} />
      )}
    </div>
  );
}

// ---------- Chủ đề ----------

function ThemesEditor({ data, onChange }: { data: ThemeLibrary; onChange: (d: ThemeLibrary) => void }) {
  const codes = Object.keys(data);
  const update = (code: string, patch: Partial<ThemeLibrary[string]>) => onChange({ ...data, [code]: { ...data[code], ...patch } });
  const nextCode = () => {
    let n = codes.length + 1;
    while (data[`T${String(n).padStart(2, "0")}`]) n++;
    return `T${String(n).padStart(2, "0")}`;
  };
  return (
    <div className="space-y-3">
      {codes.map((code) => {
        const t = data[code];
        return (
          <Card
            key={code}
            title={
              <span>
                {code} · {t.name} {t.needs_review && <span className="badge ml-2 border-amber-500 bg-amber-100 normal-case">tên gợi ý — cần duyệt</span>}
              </span>
            }
            actions={
              <>
                {t.needs_review && (
                  <button className="btn-mint btn-sm" onClick={() => update(code, { needs_review: false })}>
                    ✓ Đã duyệt
                  </button>
                )}
                <button
                  className="btn-ghost btn-sm"
                  onClick={() => {
                    if (!window.confirm(`Xoá chủ đề ${code}?`)) return;
                    const n = { ...data };
                    delete n[code];
                    onChange(n);
                  }}
                >
                  Xoá
                </button>
              </>
            }
          >
            <div className="grid gap-3 md:grid-cols-4">
              <Field label="Tên (VI)">
                <input className="input" value={t.name} onChange={(e) => update(code, { name: e.target.value })} />
              </Field>
              <div className="md:col-span-2">
                <Field label="Cảm xúc (mood, EN)">
                  <input className="input" value={t.mood} onChange={(e) => update(code, { mood: e.target.value })} />
                </Field>
              </div>
              <Field label="Nhịp dựng">
                <select className="input" value={t.pacing} onChange={(e) => update(code, { pacing: e.target.value as Tempo })}>
                  <option value="slow">slow</option>
                  <option value="mid">mid</option>
                  <option value="fast">fast</option>
                </select>
              </Field>
              <div className="md:col-span-2">
                <Field label="Signature shots (mỗi dòng một kiểu)">
                  <DraftField multiline className="input min-h-20" value={join(t.signature_shots)} onCommit={(t) => update(code, { signature_shots: lines(t) })} />
                </Field>
              </div>
              <div className="md:col-span-2">
                <Field label="Ghi chú (VI)">
                  <textarea className="input min-h-20" value={t.description_vi ?? ""} onChange={(e) => update(code, { description_vi: e.target.value })} />
                </Field>
              </div>
            </div>
          </Card>
        );
      })}
      <button
        className="btn-ghost"
        onClick={() => onChange({ ...data, [nextCode()]: { name: "Chủ đề mới", mood: "", pacing: "mid", signature_shots: [], needs_review: true } })}
      >
        ＋ Thêm chủ đề
      </button>
    </div>
  );
}

// ---------- Địa điểm ----------

function LocationsEditor({ data, onChange }: { data: LocationLibrary; onChange: (d: LocationLibrary) => void }) {
  const keys = Object.keys(data);
  const [selected, setSelected] = useState<string | null>(keys[0] ?? null);
  const [q, setQ] = useState("");
  const shown = useMemo(() => keys.filter((k) => k.toLowerCase().includes(q.toLowerCase()) || (data[k].region ?? "").toLowerCase().includes(q.toLowerCase())), [keys, q, data]);
  const loc = selected ? data[selected] : null;
  const update = (patch: Partial<LocationData>) => selected && onChange({ ...data, [selected]: { ...data[selected], ...patch } });

  function rename(newKey: string) {
    if (!selected || !newKey.trim() || newKey === selected || data[newKey]) return;
    const entries = Object.entries(data).map(([k, v]) => (k === selected ? [newKey, v] : [k, v]));
    onChange(Object.fromEntries(entries));
    setSelected(newKey);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <Card>
        <input className="input mb-2" placeholder="Tìm địa điểm…" value={q} onChange={(e) => setQ(e.target.value)} />
        <ul className="max-h-[65vh] space-y-0.5 overflow-y-auto text-sm">
          {shown.map((k) => (
            <li key={k}>
              <button
                className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left ${k === selected ? "bg-cherry text-white" : "hover:bg-cream-dark"}`}
                onClick={() => setSelected(k)}
              >
                <span className="flex-1">{k}</span>
                {data[k].auto_generated && <span className="rounded bg-amber-300 px-1 text-[10px] font-bold text-ink">TỰ SINH</span>}
              </button>
            </li>
          ))}
        </ul>
        <button
          className="btn-ghost btn-sm mt-2 w-full"
          onClick={() => {
            const name = window.prompt("Tên địa điểm mới (ví dụ: Miami Beach)")?.trim();
            if (!name || data[name]) return;
            onChange({ ...data, [name]: { region: "", aliases: [], landmarks: [], vehicles: [], wardrobe: [], props: [], light: "", notes: "", forbidden: [], auto_generated: false } });
            setSelected(name);
          }}
        >
          ＋ Thêm địa điểm
        </button>
      </Card>

      {loc && selected && (
        <Card
          title={selected}
          actions={
            <>
              {loc.auto_generated && (
                <button className="btn-mint btn-sm" onClick={() => update({ auto_generated: false })}>
                  ✓ Duyệt (bỏ đánh dấu tự sinh)
                </button>
              )}
              <button
                className="btn-ghost btn-sm"
                onClick={() => {
                  if (!window.confirm(`Xoá địa điểm ${selected}?`)) return;
                  const n = { ...data };
                  delete n[selected];
                  onChange(n);
                  setSelected(Object.keys(n)[0] ?? null);
                }}
              >
                Xoá
              </button>
            </>
          }
        >
          {loc.auto_generated && (
            <p className="mb-3 rounded border border-amber-500 bg-amber-100 px-2 py-1 text-sm">Địa điểm này do AI tự suy luận khi sinh MV — hãy kiểm tra độ chính xác theo thời kỳ rồi bấm Duyệt.</p>
          )}
          <div className="grid gap-3 md:grid-cols-2" key={selected}>
            <Field label="Tên (khoá dùng để khớp world_location)">
              <input className="input" defaultValue={selected} key={selected} onBlur={(e) => rename(e.target.value.trim())} />
            </Field>
            <Field label="Vùng">
              <input className="input" value={loc.region ?? ""} onChange={(e) => update({ region: e.target.value })} />
            </Field>
            <Field label="Tên gọi khác (alias, phân cách bằng dấu phẩy)">
              <DraftField value={(loc.aliases ?? []).join(", ")} onCommit={(t) => update({ aliases: t.split(",").map((x) => x.trim()).filter(Boolean) })} />
            </Field>
            <Field label="Ánh sáng đặc trưng">
              <input className="input" value={loc.light} onChange={(e) => update({ light: e.target.value })} />
            </Field>
            <Field label="Landmark (mỗi dòng một mục, mô tả hình ảnh, không có chữ/logo)">
              <DraftField multiline className="input min-h-28" value={join(loc.landmarks)} onCommit={(t) => update({ landmarks: lines(t) })} />
            </Field>
            <Field label="Xe hơi (ghi đời ở đầu, vd. 1954 Chevrolet Bel Air)">
              <DraftField multiline className="input min-h-28" value={join(loc.vehicles)} onCommit={(t) => update({ vehicles: lines(t) })} />
            </Field>
            <Field label="Trang phục">
              <DraftField multiline className="input min-h-24" value={join(loc.wardrobe)} onCommit={(t) => update({ wardrobe: lines(t) })} />
            </Field>
            <Field label="Đạo cụ">
              <DraftField multiline className="input min-h-24" value={join(loc.props)} onCommit={(t) => update({ props: lines(t) })} />
            </Field>
            <Field label="Không được xuất hiện (mỗi dòng: cụm từ | lý do)">
              <DraftField
                multiline
                className="input min-h-24"
                value={(loc.forbidden ?? []).map((f) => `${f.term}${f.reason_vi ? ` | ${f.reason_vi}` : ""}`).join("\n")}
                onCommit={(t) =>
                  update({
                    forbidden: lines(t).map((l) => {
                      const [term, ...rest] = l.split("|");
                      const old = (loc.forbidden ?? []).find((f) => f.term === term.trim());
                      return { ...(old?.patterns ? { patterns: old.patterns } : {}), term: term.trim(), reason_vi: rest.join("|").trim() || undefined };
                    }),
                  })
                }
              />
            </Field>
            <Field label="Ghi chú (VI)">
              <textarea className="input min-h-24" value={loc.notes ?? ""} onChange={(e) => update({ notes: e.target.value })} />
            </Field>
          </div>
        </Card>
      )}
    </div>
  );
}

// ---------- Quy tắc niên đại ----------

function EraEditor({ data, onChange }: { data: EraRules; onChange: (d: EraRules) => void }) {
  const years = Object.keys(data.years).sort();
  const [year, setYear] = useState(years[0] ?? "1950");
  const y = data.years[year];
  const updateYear = (patch: Partial<EraRules["years"][string]>) => onChange({ ...data, years: { ...data.years, [year]: { ...data.years[year], ...patch } } });
  return (
    <div className="space-y-4">
      <Card title="Theo từng năm">
        <div className="mb-3 flex flex-wrap gap-1">
          {years.map((yy) => (
            <button key={yy} className={`rounded-full border-2 border-ink px-3 py-0.5 text-sm font-semibold ${yy === year ? "bg-mint" : "bg-white"}`} onClick={() => setYear(yy)}>
              {yy}
            </button>
          ))}
        </div>
        {y && (
          <div className="grid gap-3 md:grid-cols-2" key={year}>
            <Field label="Xe hợp lệ trong năm">
              <DraftField multiline className="input min-h-28" value={join(y.vehicles)} onCommit={(t) => updateYear({ vehicles: lines(t) })} />
            </Field>
            <Field label="Kiểu tóc">
              <DraftField multiline className="input min-h-28" value={join(y.hairstyles)} onCommit={(t) => updateYear({ hairstyles: lines(t) })} />
            </Field>
            <Field label="Trang phục">
              <DraftField multiline className="input min-h-28" value={join(y.fashion)} onCommit={(t) => updateYear({ fashion: lines(t) })} />
            </Field>
            <Field label="Vật dụng">
              <DraftField multiline className="input min-h-28" value={join(y.props)} onCommit={(t) => updateYear({ props: lines(t) })} />
            </Field>
            <Field label="Nhạc & điệu nhảy">
              <DraftField multiline className="input min-h-20" value={join(y.music_dance)} onCommit={(t) => updateYear({ music_dance: lines(t) })} />
            </Field>
            <Field label="Ghi chú (VI)">
              <textarea className="input min-h-20" value={y.notes_vi ?? ""} onChange={(e) => updateYear({ notes_vi: e.target.value })} />
            </Field>
          </div>
        )}
      </Card>

      <Card title="Vật dụng / xe theo năm ra đời (cảnh trước năm này sẽ bị cảnh báo)">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-muted">
                <th className="p-1">Tên</th>
                <th className="w-24 p-1">Từ năm</th>
                <th className="p-1">Mẫu nhận diện (regex, phân cách bằng ;;)</th>
                <th className="w-10 p-1"></th>
              </tr>
            </thead>
            <tbody>
              {data.introduced.map((it, i) => {
                const upd = (patch: Partial<EraRules["introduced"][number]>) => onChange({ ...data, introduced: data.introduced.map((x, k) => (k === i ? { ...x, ...patch } : x)) });
                return (
                  <tr key={`${i}/${data.introduced.length}`}>
                    <td className="p-1">
                      <input className="input" value={it.term} onChange={(e) => upd({ term: e.target.value })} />
                    </td>
                    <td className="p-1">
                      <input className="input" type="number" value={it.year} onChange={(e) => upd({ year: Number(e.target.value) })} />
                    </td>
                    <td className="p-1">
                      <DraftField
                        className="input font-mono text-xs"
                        value={it.patterns.join(" ;; ")}
                        onCommit={(t) => upd({ patterns: t.split(";;").map((x) => x.trim()).filter(Boolean) })}
                      />
                    </td>
                    <td className="p-1">
                      <button className="btn-ghost btn-sm" onClick={() => onChange({ ...data, introduced: data.introduced.filter((_, k) => k !== i) })}>
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button className="btn-ghost btn-sm mt-2" onClick={() => onChange({ ...data, introduced: [...data.introduced, { term: "", year: 1960, patterns: [] }] })}>
          ＋ Thêm mục
        </button>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Thương hiệu / người thật (cảnh báo nếu xuất hiện)">
          <DraftField multiline className="input min-h-40" value={join(data.brands_and_people)} onCommit={(t) => onChange({ ...data, brands_and_people: lines(t) })} />
        </Card>
        <Card title="Hãng / dòng xe (để kiểm tra đời xe)">
          <DraftField multiline className="input min-h-40" value={join(data.vehicle_makes)} onCommit={(t) => onChange({ ...data, vehicle_makes: lines(t) })} />
        </Card>
      </div>
      <p className="text-xs text-muted">Danh sách đồ vật hiện đại bị cấm (global_forbidden) và mẫu nhận diện chữ trên màn hình: bật “Sửa JSON trực tiếp” để chỉnh.</p>
    </div>
  );
}

// ---------- Style ----------

function StylesEditor({ data, onChange }: { data: StyleLibrary; onChange: (d: StyleLibrary) => void }) {
  const update = (k: string, patch: Partial<StyleLibrary[string]>) => onChange({ ...data, [k]: { ...data[k], ...patch } });
  return (
    <div className="space-y-3">
      {Object.entries(data).map(([k, st]) => (
        <Card
          key={k}
          title={`${st.name} (${k})`}
          actions={
            <button
              className="btn-ghost btn-sm"
              onClick={() => {
                if (Object.keys(data).length <= 1 || !window.confirm(`Xoá style ${st.name}?`)) return;
                const n = { ...data };
                delete n[k];
                onChange(n);
              }}
            >
              Xoá
            </button>
          }
        >
          <div className="grid gap-3">
            <Field label="Tên hiển thị">
              <input className="input" value={st.name} onChange={(e) => update(k, { name: e.target.value })} />
            </Field>
            <Field label="Nội dung (nối vào cuối mọi prompt)">
              <textarea className="input min-h-16" value={st.text} onChange={(e) => update(k, { text: e.target.value })} />
            </Field>
            <Field label="Bản rút gọn (dùng khi prompt vượt giới hạn)">
              <input className="input" value={st.short ?? ""} onChange={(e) => update(k, { short: e.target.value })} />
            </Field>
          </div>
        </Card>
      ))}
      <button
        className="btn-ghost"
        onClick={() => {
          const key = window.prompt("Mã style mới (chữ thường, không dấu, ví dụ: polaroid)")?.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
          if (!key || data[key]) return;
          onChange({ ...data, [key]: { name: key, text: "", short: "" } });
        }}
      >
        ＋ Thêm style
      </button>
    </div>
  );
}

// ---------- Công cụ video ----------

function VideoModelsEditor({ data, onChange }: { data: VideoModelLibrary; onChange: (d: VideoModelLibrary) => void }) {
  const update = (k: string, patch: Partial<VideoModelLibrary[string]>) => onChange({ ...data, [k]: { ...data[k], ...patch } });
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {Object.entries(data).map(([k, m]) => (
        <Card key={k} title={`${m.name} (${k})`}>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Tên">
              <input className="input" value={m.name} onChange={(e) => update(k, { name: e.target.value })} />
            </Field>
            <Field label="Độ dài clip mặc định (s)">
              <input className="input" type="number" value={m.default_clip_len} onChange={(e) => update(k, { default_clip_len: Number(e.target.value) })} />
            </Field>
            <Field label="Giới hạn prompt (ký tự)">
              <input className="input" type="number" value={m.max_prompt_chars} onChange={(e) => update(k, { max_prompt_chars: Number(e.target.value) })} />
            </Field>
            <Field label="Độ dài khuyến nghị (ký tự)">
              <input className="input" type="number" value={m.target_prompt_chars} onChange={(e) => update(k, { target_prompt_chars: Number(e.target.value) })} />
            </Field>
            <Field label="Các độ dài clip hỗ trợ (s, phẩy)">
              <DraftField value={m.clip_lengths.join(", ")} onCommit={(t) => update(k, { clip_lengths: t.split(",").map((x) => Number(x.trim())).filter((x) => x > 0) })} />
            </Field>
            <div className="space-y-1 pt-5 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={m.supports_audio} onChange={(e) => update(k, { supports_audio: e.target.checked })} /> Hỗ trợ mô tả âm thanh
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={m.supports_negative_prompt} onChange={(e) => update(k, { supports_negative_prompt: e.target.checked })} /> Có ô negative prompt
              </label>
            </div>
            <div className="md:col-span-2">
              <Field label="Cách viết prompt (gửi cho Claude, EN)">
                <textarea className="input min-h-16" value={m.prompt_style} onChange={(e) => update(k, { prompt_style: e.target.value })} />
              </Field>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
