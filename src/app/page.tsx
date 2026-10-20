"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import CostEstimate from "@/components/CostEstimate";
import { Card, ErrorBox, Field, Spinner } from "@/components/ui";
import { createBatch, unfinished } from "@/lib/batch";
import { batchEngine } from "@/lib/batchEngine";
import { api } from "@/lib/client";
import { extractYear, matchLocation, parseDuration, parseTempo, splitThemeCell, type ParseResult } from "@/lib/parser";
import type { IdeaRow, LocationLibrary, ThemeLibrary, Tone } from "@/lib/types";
import { useStatus } from "@/lib/useStatus";

const SAMPLE = `1 | Hollywood Boulevard Summer 1954 | T01 Sét ái tình       | Chàng trai bắt gặp cô gái bước ra khỏi rạp phim giữa Boulevard đông đúc; chỉ một ánh mắt khiến cả Hollywood như biến mất.
2 | Hollywood Drive-In Night 1956    | T11 Nụ hôn diệu kỳ    | Buổi hẹn đầu ở drive-in; bộ phim chẳng còn quan trọng sau nụ hôn đầu dưới ánh sáng màn chiếu.
3 | Sunset Boulevard Rock & Roll 1957| T09 Rung động mãnh liệt| Một cô gái nhảy Rock & Roll trong club khiến chàng trai hoàn toàn mất bình tĩnh.
4 | Hollywood Summer Nights 1958     | T08 Say đắm & ngây ngất| Hai người rong chơi Hollywood cả đêm, cảm giác như mình là ngôi sao của chính bộ phim tình yêu.
5 | Santa Monica Pier Summer 1954    | T01 Sét ái tình       | Gặp nhau tình cờ trên pier giữa tiếng nhạc và biển; dành cả buổi chiều tìm cách gặp lại.`;

const SAMPLE_SERIES = "1–50 · California – Las Vegas – Route 66 – New York";

const TONES: { value: Tone; label: string }[] = [
  { value: "default", label: "Mặc định" },
  { value: "playful", label: "Vui tươi hơn" },
  { value: "melancholy", label: "Buồn hơn" },
  { value: "cinematic", label: "Điện ảnh hơn" },
];

type Tab = "single" | "paste" | "upload";

const emptyForm = {
  id: "1",
  world_location: "",
  theme: "T01",
  outline: "",
  song_title: "",
  duration: "",
  tempo: "",
  lyrics: "",
  series: "",
};

export default function HomePage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("paste");
  const [themes, setThemes] = useState<ThemeLibrary>({});
  const [locations, setLocations] = useState<LocationLibrary>({});
  const [form, setForm] = useState(emptyForm);
  const [pasteText, setPasteText] = useState("");
  const [series, setSeries] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [tone, setTone] = useState<Tone>("default");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { status } = useStatus();

  useEffect(() => {
    api<ThemeLibrary>("/api/library/themes").then(setThemes).catch(() => {});
    api<LocationLibrary>("/api/library/locations").then(setLocations).catch(() => {});
  }, []);

  const set = (k: keyof typeof emptyForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function startBatch(ideas: IdeaRow[]) {
    if (status?.mode === "manual") {
      // claude.ai: tạo bản nháp, người dùng copy yêu cầu và dán câu trả lời ở trang claude.ai.
      setBusy(true);
      try {
        await api("/api/drafts", { method: "POST", json: { ideas, tone } });
        router.push("/manual");
      } catch (e) {
        setError((e as Error).message);
        setBusy(false);
      }
      return;
    }
    batchEngine.ensureLoaded();
    const left = unfinished(batchEngine.batch);
    if (left && !window.confirm(`Batch hiện tại còn ${left} MV chưa chạy xong. Thay bằng batch mới?`)) return;
    batchEngine.replace(createBatch(ideas, tone));
    router.push("/batch?autostart=1");
  }

  function singleIdea(): IdeaRow | null {
    if (!form.world_location.trim() || !form.outline.trim()) return null;
    const { code, name } = splitThemeCell(form.theme);
    const duration = form.duration ? parseDuration(form.duration) : undefined;
    return {
      id: form.id.trim() || "1",
      world_location: form.world_location.trim(),
      theme_code: code,
      theme_name: name ?? themes[code]?.name,
      outline: form.outline.trim(),
      ...(duration && { duration_sec: duration }),
      ...parseTempo(form.tempo),
      ...(form.lyrics.trim() && { lyrics: form.lyrics }),
    };
  }

  function submitSingle(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { code, name } = splitThemeCell(form.theme);
    const tempo = parseTempo(form.tempo);
    const duration = form.duration ? parseDuration(form.duration) : undefined;
    if (form.duration && !duration) return setError("Thời lượng không hợp lệ (ví dụ: 180, 3:20).");
    if (!form.world_location.trim() || !form.outline.trim()) return setError("Cần nhập bối cảnh (world_location) và khung sườn (outline).");
    const idea: IdeaRow = {
      id: form.id.trim() || "1",
      world_location: form.world_location.trim(),
      theme_code: code,
      theme_name: name ?? themes[code]?.name,
      outline: form.outline.trim(),
      ...(form.song_title.trim() && { song_title: form.song_title.trim() }),
      ...(duration && { duration_sec: duration }),
      ...tempo,
      ...(form.lyrics.trim() && { lyrics: form.lyrics }),
      ...(form.series.trim() && { series: form.series.trim() }),
    };
    startBatch([idea]);
  }

  async function readTable() {
    setError(null);
    setBusy(true);
    try {
      if (tab === "paste") {
        setParsed(await api<ParseResult>("/api/parse", { method: "POST", json: { text: pasteText, series } }));
      } else if (file) {
        const fd = new FormData();
        fd.set("file", file);
        fd.set("series", series);
        setParsed(await api<ParseResult>("/api/parse", { method: "POST", body: fd }));
      }
    } catch (e) {
      setError((e as Error).message);
      setParsed(null);
    } finally {
      setBusy(false);
    }
  }

  const rows = useMemo(() => parsed?.rows ?? [], [parsed]);
  const removeRow = (i: number) => setParsed((p) => (p ? { ...p, rows: p.rows.filter((_, k) => k !== i) } : p));
  const validRows = rows.filter((r) => r.world_location && r.theme_code && r.outline);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl uppercase text-ink">Nhập ý tưởng</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Mỗi dòng ý tưởng sẽ thành một bộ prompt hoàn chỉnh cho cả MV: nhân vật cố định, phong cách hình ảnh thống nhất, storyboard theo cấu trúc bài hát
          và prompt tiếng Anh cho từng cảnh.
        </p>
      </div>

      <div>
        <div className="flex gap-1">
          {(
            [
              ["single", "Nhập 1 bài"],
              ["paste", "Dán bảng"],
              ["upload", "Upload CSV / XLSX"],
            ] as [Tab, string][]
          ).map(([t, label]) => (
            <button
              key={t}
              className={`rounded-t-lg border-2 border-b-0 border-ink/80 px-4 py-1.5 text-sm font-semibold ${tab === t ? "bg-white text-cherry" : "bg-cream-dark text-muted hover:text-ink"}`}
              onClick={() => {
                setTab(t);
                setError(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="card rounded-tl-none p-5">
          {tab === "single" && (
            <form onSubmit={submitSingle} className="grid gap-4 md:grid-cols-6">
              <div className="md:col-span-1">
                <Field label="ID">
                  <input className="input" value={form.id} onChange={set("id")} />
                </Field>
              </div>
              <div className="md:col-span-3">
                <Field label="Bối cảnh (world_location) *" hint="Nên có năm, ví dụ: Hollywood Boulevard Summer 1954">
                  <input className="input" value={form.world_location} onChange={set("world_location")} placeholder="Hollywood Boulevard Summer 1954" />
                </Field>
              </div>
              <div className="md:col-span-2">
                <Field label="Chủ đề *">
                  <select className="input" value={form.theme} onChange={set("theme")}>
                    {Object.entries(themes).map(([code, t]) => (
                      <option key={code} value={code}>
                        {code} · {t.name}
                        {t.needs_review ? " (gợi ý)" : ""}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="md:col-span-6">
                <Field label="Khung sườn (outline, tiếng Việt) *">
                  <textarea className="input min-h-20" value={form.outline} onChange={set("outline")} placeholder="Chàng trai bắt gặp cô gái bước ra khỏi rạp phim…" />
                </Field>
              </div>
              <div className="md:col-span-2">
                <Field label="Tên bài hát">
                  <input className="input" value={form.song_title} onChange={set("song_title")} placeholder="Ferris Wheel Heart" />
                </Field>
              </div>
              <div className="md:col-span-1">
                <Field label="Thời lượng" hint="giây hoặc m:ss">
                  <input className="input" value={form.duration} onChange={set("duration")} placeholder="180" />
                </Field>
              </div>
              <div className="md:col-span-1">
                <Field label="Nhịp / BPM" hint="slow, mid, fast hoặc số">
                  <input className="input" value={form.tempo} onChange={set("tempo")} placeholder="theo chủ đề" />
                </Field>
              </div>
              <div className="md:col-span-2">
                <Field label="Series">
                  <input className="input" value={form.series} onChange={set("series")} placeholder={SAMPLE_SERIES} />
                </Field>
              </div>
              <div className="md:col-span-6">
                <Field label="Lời bài hát (không bắt buộc)" hint="Có thể ghi nhãn [Verse 1], [Chorus], [Bridge]… để khớp cảnh chính xác hơn.">
                  <textarea className="input min-h-24 font-mono text-xs" value={form.lyrics} onChange={set("lyrics")} />
                </Field>
              </div>
              <div className="md:col-span-6">
                <CostEstimate ideas={[singleIdea()].filter((x): x is IdeaRow => Boolean(x))} themes={themes} status={status} />
              </div>
              <div className="flex flex-wrap items-center gap-3 md:col-span-6">
                <ToneSelect tone={tone} setTone={setTone} />
                <button type="submit" className="btn-primary ml-auto" disabled={busy}>
                  {busy && <Spinner />} {status?.mode === "manual" ? "Tạo yêu cầu cho claude.ai →" : "Sinh MV →"}
                </button>
              </div>
            </form>
          )}

          {tab === "paste" && (
            <div className="space-y-3">
              <Field
                label="Dán bảng từ Google Docs / Sheets"
                hint="Cột theo thứ tự: id | world_location | theme (T01 Tên chủ đề) | outline | [tên bài] | [thời lượng] | [nhịp] | [lời] | [series]. Tách bằng tab hoặc |. Có thể có dòng tiêu đề."
              >
                <textarea className="input min-h-44 font-mono text-xs" value={pasteText} onChange={(e) => setPasteText(e.target.value)} />
              </Field>
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-64 flex-1">
                  <Field label="Series (áp dụng cho các dòng không có cột series)">
                    <input className="input" value={series} onChange={(e) => setSeries(e.target.value)} placeholder={SAMPLE_SERIES} />
                  </Field>
                </div>
                <button
                  className="btn-ghost"
                  onClick={() => {
                    setPasteText(SAMPLE);
                    setSeries(SAMPLE_SERIES);
                  }}
                >
                  Dùng 5 dòng ví dụ
                </button>
                <button className="btn-mint" onClick={readTable} disabled={busy || !pasteText.trim()}>
                  {busy && <Spinner />} Đọc bảng & xem trước
                </button>
              </div>
            </div>
          )}

          {tab === "upload" && (
            <div className="space-y-3">
              <Field label="File CSV / XLSX" hint="Dòng đầu là tiêu đề cột: id, world_location, theme_code, theme_name, outline, song_title, duration_sec, bpm, lyrics, series (tiếng Việt cũng được).">
                <input
                  type="file"
                  accept=".csv,.tsv,.txt,.xlsx"
                  className="input"
                  onChange={(e) => {
                    setFile(e.target.files?.[0] ?? null);
                    setParsed(null);
                  }}
                />
              </Field>
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-64 flex-1">
                  <Field label="Series (nếu file không có cột series)">
                    <input className="input" value={series} onChange={(e) => setSeries(e.target.value)} placeholder={SAMPLE_SERIES} />
                  </Field>
                </div>
                <button className="btn-mint" onClick={readTable} disabled={busy || !file}>
                  {busy && <Spinner />} Đọc file & xem trước
                </button>
              </div>
            </div>
          )}
          <div className="mt-3">
            <ErrorBox error={error} />
          </div>
        </div>
      </div>

      {parsed && tab !== "single" && (
        <Card
          title={`Xem trước — ${rows.length} dòng`}
          actions={
            <>
              <ToneSelect tone={tone} setTone={setTone} />
              <button className="btn-primary" disabled={!validRows.length || busy} onClick={() => startBatch(validRows)}>
                {busy && <Spinner />}{" "}
                {status?.mode === "manual" ? `Tạo ${validRows.length} yêu cầu cho claude.ai →` : `Chạy batch (${validRows.length} MV) →`}
              </button>
            </>
          }
        >
          <div className="mb-3">
            <CostEstimate ideas={validRows} themes={themes} status={status} />
          </div>
          <p className="mb-3 text-xs text-muted">
            Đã nhận diện {parsed.headerDetected ? "dòng tiêu đề" : "cột theo vị trí"} · tách bằng{" "}
            {{ tab: "tab", pipe: "dấu |", comma: "dấu phẩy", matrix: "ô Excel" }[parsed.delimiter]}.
          </p>
          {parsed.warnings.length > 0 && (
            <ul className="mb-3 list-disc space-y-0.5 pl-5 text-sm text-amber-800">
              {parsed.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-ink text-left text-xs uppercase text-muted">
                  <th className="p-2">ID</th>
                  <th className="p-2">Bối cảnh</th>
                  <th className="p-2">Chủ đề</th>
                  <th className="p-2">Khung sườn</th>
                  <th className="p-2">Bài / thời lượng / nhịp</th>
                  <th className="p-2">Series</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const year = extractYear(r.world_location);
                  const loc = matchLocation(r.world_location, locations);
                  const theme = themes[r.theme_code];
                  return (
                    <tr key={i} className="border-b border-ink/15 align-top">
                      <td className="p-2 font-semibold">{r.id}</td>
                      <td className="p-2">
                        <div>{r.world_location || <span className="text-cherry">thiếu</span>}</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {year ? <span className="badge">{year}</span> : <span className="badge border-amber-500 bg-amber-100">chưa có năm</span>}
                          {loc ? (
                            <span className="badge border-mint-dark/50 bg-mint/30">{loc}</span>
                          ) : (
                            r.world_location && <span className="badge border-amber-500 bg-amber-100">địa điểm mới — sẽ tự suy luận</span>
                          )}
                        </div>
                      </td>
                      <td className="p-2">
                        <div className="font-semibold">{r.theme_code}</div>
                        <div className="text-xs text-muted">{r.theme_name ?? theme?.name}</div>
                        {r.theme_code && !theme && <span className="badge mt-1 border-amber-500 bg-amber-100">chưa có trong thư viện</span>}
                      </td>
                      <td className="max-w-md p-2">{r.outline || <span className="text-cherry">thiếu</span>}</td>
                      <td className="p-2 text-xs">
                        <div>{r.song_title}</div>
                        <div className="text-muted">
                          {r.duration_sec ? `${r.duration_sec}s` : "mặc định"} · {r.bpm ? `${r.bpm} BPM` : (r.tempo ?? theme?.pacing ?? "mid")}
                        </div>
                        {r.lyrics && <span className="badge mt-1">có lời</span>}
                      </td>
                      <td className="p-2 text-xs">{r.series}</td>
                      <td className="p-2">
                        <button className="btn-ghost btn-sm" onClick={() => removeRow(i)} title="Bỏ dòng này">
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function ToneSelect({ tone, setTone }: { tone: Tone; setTone: (t: Tone) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted">Giọng:</span>
      <select className="input w-auto" value={tone} onChange={(e) => setTone(e.target.value as Tone)}>
        {TONES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
    </label>
  );
}
