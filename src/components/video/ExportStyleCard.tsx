"use client";

import { useRef, useState } from "react";
import { Card, Field, Spinner } from "@/components/ui";
import { mediaUrl } from "@/lib/client";
import { FONT_EXTENSIONS, LOGO_EXTENSIONS, LOGO_POSITIONS } from "@/lib/branding";
import { LOUDNESS_PRESETS } from "@/lib/loudness";
import { QUALITY_LABEL } from "@/lib/quality";
import type { EditOptions, MediaFile, QualityPreset } from "@/lib/types";

/** Âm lượng, chất lượng, logo, intro tiêu đề và thông tin video — cách xuất của Bokin Studio Music. */
export default function ExportStyleCard({
  mvId,
  options,
  onChange,
  logo,
  font,
  songTitle,
  busy,
  onUpload,
  onRemove,
  onPreview,
}: {
  mvId: string;
  options: EditOptions;
  onChange: (o: EditOptions) => void;
  logo: MediaFile | null;
  font: MediaFile | null;
  songTitle: string;
  busy: boolean;
  onUpload: (kind: "logo" | "font", file: File) => void;
  onRemove: (kind: "logo" | "font") => void;
  /** Lưu tuỳ chọn rồi trả về URL ảnh xem thử ở giây t. */
  onPreview: (t: number) => Promise<string>;
}) {
  const logoInput = useRef<HTMLInputElement>(null);
  const fontInput = useRef<HTMLInputElement>(null);
  const [previewAt, setPreviewAt] = useState(options.intro.enabled ? 2.5 : 10);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const set = <K extends keyof EditOptions>(k: K, v: EditOptions[K]) => onChange({ ...options, [k]: v });
  const setLogo = (patch: Partial<EditOptions["logo"]>) => set("logo", { ...options.logo, ...patch });
  const setIntro = (patch: Partial<EditOptions["intro"]>) => set("intro", { ...options.intro, ...patch });
  const setMeta = (patch: Partial<EditOptions["metadata"]>) => set("metadata", { ...options.metadata, ...patch });
  const num = (v: string, lo: number, hi: number, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
  };
  const loudKey = !options.loudness.enabled ? "off" : String(options.loudness.target_lufs);

  async function showPreview() {
    setPreviewBusy(true);
    setPreviewError(null);
    try {
      const url = await onPreview(previewAt);
      const res = await fetch(url);
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `Lỗi ${res.status}`);
      const blob = await res.blob();
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(blob);
      });
    } catch (e) {
      setPreviewError((e as Error).message);
    } finally {
      setPreviewBusy(false);
    }
  }

  return (
    <Card title="4. Âm thanh, logo & intro">
      <p className="-mt-1 mb-3 text-xs text-muted">Khâu xuất dùng lại cách làm của Bokin Studio Music: cân bằng âm lượng, chuẩn upload YouTube, logo kênh, intro tiêu đề và thông tin video.</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-3 rounded-lg border border-ink/15 p-3">
          <h3 className="label">Âm thanh & chất lượng</h3>
          <Field label="Cân bằng âm lượng" hint="Đo độ to (ebur128) rồi chỉnh bằng một mức gain cố định — không nén tiếng; đỉnh sau khi mã hoá AAC không vượt −1,5 dBTP.">
            <select
              className="input"
              value={LOUDNESS_PRESETS.some((p) => p.value === loudKey) ? loudKey : "-14"}
              onChange={(e) => set("loudness", LOUDNESS_PRESETS.find((p) => p.value === e.target.value)!.config)}
            >
              {LOUDNESS_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Chất lượng xuất" hint={options.quality === "youtube" ? "H.264 High, màu BT.709, keyframe mỗi nửa giây, bitrate theo khuyến nghị YouTube, AAC 384 kbps." : "Mã hoá nhanh, file nhẹ hơn — dùng để xem thử trước khi xuất bản đẹp."}>
            <select className="input" value={options.quality} onChange={(e) => set("quality", e.target.value as QualityPreset)}>
              {(Object.keys(QUALITY_LABEL) as QualityPreset[]).map((k) => (
                <option key={k} value={k}>
                  {QUALITY_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
        </section>

        <section className="space-y-3 rounded-lg border border-ink/15 p-3">
          <div className="flex items-center gap-2">
            <h3 className="label mb-0">Logo kênh</h3>
            <div className="ml-auto flex gap-1.5">
              <button className="btn-ghost btn-sm" disabled={busy} onClick={() => logoInput.current?.click()}>
                {logo ? "Đổi logo" : "Chọn ảnh logo"}
              </button>
              {logo && (
                <button className="btn-ghost btn-sm" disabled={busy} onClick={() => onRemove("logo")}>
                  Bỏ logo
                </button>
              )}
            </div>
          </div>
          <input
            ref={logoInput}
            type="file"
            accept={LOGO_EXTENSIONS.join(",")}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) onUpload("logo", f);
            }}
          />
          {logo ? (
            <div className="flex items-start gap-3">
              <img
                src={mediaUrl(mvId, logo.file)}
                alt="logo"
                className={`h-16 w-16 border border-ink/20 bg-[conic-gradient(#eee_25%,#fff_0_50%,#eee_0_75%,#fff_0)] bg-[length:12px_12px] object-contain ${options.logo.shape === "circle" ? "rounded-full" : "rounded"}`}
              />
              <div className="grid flex-1 grid-cols-2 gap-2">
                <Field label="Vị trí">
                  <select className="input py-1" value={options.logo.position} onChange={(e) => setLogo({ position: e.target.value as EditOptions["logo"]["position"] })}>
                    {LOGO_POSITIONS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Dạng">
                  <select className="input py-1" value={options.logo.shape} onChange={(e) => setLogo({ shape: e.target.value as EditOptions["logo"]["shape"] })}>
                    <option value="original">Giữ nguyên</option>
                    <option value="circle">Cắt tròn</option>
                  </select>
                </Field>
                <Field label="Cỡ (% chiều ngang)">
                  <input className="input py-1" type="number" min={2} max={50} value={options.logo.size_percent} onChange={(e) => setLogo({ size_percent: num(e.target.value, 2, 50, 12) })} />
                </Field>
                <Field label="Độ hiện (%)">
                  <input className="input py-1" type="number" min={10} max={100} value={options.logo.opacity_percent} onChange={(e) => setLogo({ opacity_percent: num(e.target.value, 10, 100, 100) })} />
                </Field>
                <Field label="Lề (%)">
                  <input className="input py-1" type="number" min={0} max={20} value={options.logo.margin_percent} onChange={(e) => setLogo({ margin_percent: num(e.target.value, 0, 20, 3) })} />
                </Field>
                <Field label="Hiện từ giây">
                  <input className="input py-1" type="number" min={0} step={0.5} value={options.logo.start_seconds} onChange={(e) => setLogo({ start_seconds: num(e.target.value, 0, 3600, 0) })} />
                </Field>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted">Ảnh PNG / JPG / WEBP. Logo tròn lưu dạng JPG thì chọn “Cắt tròn” để bỏ viền trắng.</p>
          )}
        </section>

        <section className="space-y-3 rounded-lg border border-ink/15 p-3">
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={options.intro.enabled} onChange={(e) => setIntro({ enabled: e.target.checked })} />
            Intro tiêu đề ở đầu video
          </label>
          <p className="-mt-2 text-xs text-muted">Hình mờ dần từ đen, nền nhoè, tiêu đề hiện lên rồi tắt; sau đó nền rõ lại trong 1,5 giây.</p>
          <div className={`grid grid-cols-2 gap-2 ${options.intro.enabled ? "" : "pointer-events-none opacity-50"}`}>
            <Field label="Tiêu đề">
              <input className="input py-1" maxLength={100} value={options.intro.title} placeholder={songTitle} onChange={(e) => setIntro({ title: e.target.value })} />
            </Field>
            <Field label="Dòng phụ">
              <input className="input py-1" maxLength={100} value={options.intro.subtitle} placeholder="vd. tên kênh" onChange={(e) => setIntro({ subtitle: e.target.value })} />
            </Field>
            <Field label="Dài (giây)">
              <input className="input py-1" type="number" min={2} max={30} step={0.5} value={options.intro.seconds} onChange={(e) => setIntro({ seconds: num(e.target.value, 2, 30, 6) })} />
            </Field>
            <Field label="Độ nhoè nền">
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={options.intro.background_blur} onChange={(e) => setIntro({ background_blur: e.target.checked })} />
                <input
                  type="range"
                  min={5}
                  max={100}
                  value={options.intro.blur_percent}
                  disabled={!options.intro.background_blur}
                  onChange={(e) => setIntro({ blur_percent: Number(e.target.value) })}
                  className="flex-1"
                />
              </div>
            </Field>
            <div className="col-span-2 flex items-center gap-2 text-xs">
              <span className="text-muted">Font: {font ? <b className="text-ink">{font.name}</b> : "font đậm có tiếng Việt của máy (Segoe UI / Arial)"}</span>
              <button className="btn-ghost btn-sm ml-auto" disabled={busy} onClick={() => fontInput.current?.click()}>
                {font ? "Đổi font" : "Chọn font (.ttf/.otf)"}
              </button>
              {font && (
                <button className="btn-ghost btn-sm" disabled={busy} onClick={() => onRemove("font")}>
                  Font mặc định
                </button>
              )}
              <input
                ref={fontInput}
                type="file"
                accept={FONT_EXTENSIONS.join(",")}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) onUpload("font", f);
                }}
              />
            </div>
          </div>
        </section>

        <section className="space-y-2 rounded-lg border border-ink/15 p-3">
          <h3 className="label">Thông tin video (ghi vào file MP4)</h3>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Tiêu đề">
              <input className="input py-1" value={options.metadata.title} placeholder={songTitle} onChange={(e) => setMeta({ title: e.target.value })} />
            </Field>
            <Field label="Tác giả / kênh">
              <input className="input py-1" value={options.metadata.artist} onChange={(e) => setMeta({ artist: e.target.value })} />
            </Field>
            <Field label="Thể loại">
              <input className="input py-1" value={options.metadata.genre} onChange={(e) => setMeta({ genre: e.target.value })} />
            </Field>
            <Field label="Năm">
              <input className="input py-1" maxLength={10} value={options.metadata.year} onChange={(e) => setMeta({ year: e.target.value })} />
            </Field>
          </div>
          <Field label="Ghi chú">
            <textarea className="input min-h-14 py-1" value={options.metadata.comment} onChange={(e) => setMeta({ comment: e.target.value })} />
          </Field>
        </section>
      </div>

      <div className="mt-4 rounded-lg border border-ink/15 bg-cream/50 p-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">Xem thử khung hình ở giây</span>
          <input className="input w-20 py-1" type="number" min={0} step={0.5} value={previewAt} onChange={(e) => setPreviewAt(num(e.target.value, 0, 7200, 0))} />
          <button className="btn-mint btn-sm" onClick={showPreview} disabled={previewBusy || busy} data-testid="preview-frame">
            {previewBusy && <Spinner />} Xem thử
          </button>
          <span className="text-xs text-muted">Logo, intro, màu và khung hình đúng như khi dựng — không cần dựng cả video.</span>
        </div>
        {previewError && <p className="mt-2 text-xs text-cherry-dark">{previewError}</p>}
        {preview && <img src={preview} alt="Xem thử khung hình" className="mt-3 max-h-96 rounded-md border-2 border-ink bg-black" data-testid="preview-image" />}
      </div>
    </Card>
  );
}
