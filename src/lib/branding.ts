// Logo kênh và intro tiêu đề — chuyển từ Bokin Studio Music (loop_music/branding.py, kiểu intro "title").
// Khác ở chỗ MV gồm nhiều đoạn cắt dựng riêng: mỗi đoạn được đẩy mốc thời gian về đúng vị trí trên timeline
// (setpts=PTS+giây bắt đầu) trước các hiệu ứng, nên logo mờ dần, intro và nền mờ nối liền qua các nhát cắt.
// Chữ được đọc từ file (không bao giờ chèn chữ của người dùng vào filtergraph): ASS (libass) hoặc drawtext textfile.

import type { IntroConfig, LogoLayout, Mp4Tags, MVResult, VideoMetadata } from "./types";

export const LOGO_POSITIONS: { value: LogoLayout["position"]; label: string }[] = [
  { value: "top-left", label: "Góc trên trái" },
  { value: "top-right", label: "Góc trên phải" },
  { value: "bottom-left", label: "Góc dưới trái" },
  { value: "bottom-right", label: "Góc dưới phải" },
];
export const LOGO_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".bmp"];
export const FONT_EXTENSIONS = [".ttf", ".otf", ".ttc"];

export const DEFAULT_LOGO_LAYOUT: LogoLayout = {
  position: "top-right",
  size_percent: 12,
  opacity_percent: 100,
  margin_percent: 3,
  shape: "original",
  start_seconds: 0,
};
export const DEFAULT_INTRO: IntroConfig = { enabled: false, title: "", subtitle: "", seconds: 6, background_blur: true, blur_percent: 50 };
export const DEFAULT_METADATA: VideoMetadata = { artist: "", genre: "Rock & Roll" };

/** Logo có giây bắt đầu thì mờ dần hiện ra trong khoảng này. */
export const LOGO_FADE_IN = 0.6;
/** Logo tròn được cắt vào trong 1,5% để bỏ viền trắng của logo tròn lưu dạng JPG. */
const CIRCLE_INSET = 0.985;
/** Intro tiêu đề: mờ dần từ đen ở đầu video. */
export const FADE_FROM_BLACK = 1.5;
/** Chữ bắt đầu hiện từ 0,6 s, rõ hẳn sau 1 s; tắt dần trong giây cuối của intro. */
export const TEXT_FADE_IN: [number, number] = [0.6, 1.0];
export const TEXT_FADE_OUT = 1.0;
/** Nền mờ trong lúc intro: sigma = chiều cao / 50 (21,6 px ở 1080p) × blur_percent / 50; sau intro rõ dần trong 1,5 s. */
const BLUR_SIGMA_PER_HEIGHT = 1 / 50;
const BLUR_DEFAULT_PERCENT = 50;
export const BLUR_CLEAR = 1.5;

export type TextMode = "ass" | "drawtext";

/** Số giây đầu video chịu ảnh hưởng của intro (tới khi nền rõ lại). */
export function introSpan(intro: IntroConfig): number {
  return intro.enabled ? intro.seconds + (intro.background_blur ? BLUR_CLEAR : 0) : 0;
}

export function blurSigma(intro: IntroConfig, height: number): number {
  return ((height * BLUR_SIGMA_PER_HEIGHT * intro.blur_percent) / BLUR_DEFAULT_PERCENT);
}

const f4 = (x: number) => x.toFixed(4);

/**
 * Nền mờ: sigma đầy đủ tới hết intro, rồi giảm theo từng khung (smoothstep) như kéo nét ống kính.
 * Dùng thời gian trên timeline cho đoạn [offset, offset + frames/fps); "" nếu đoạn nằm sau khi nền đã rõ.
 */
export function focusPull(intro: IntroConfig, fps: number, height: number, offset: number, frames: number): string {
  if (!intro.enabled || !intro.background_blur) return "";
  const sigma = blurSigma(intro, height);
  const start = intro.seconds;
  const end = intro.seconds + BLUR_CLEAR;
  if (offset >= end) return "";
  const valueAt = (t: number) => {
    const u = Math.min(1, Math.max(0, (t - start) / BLUR_CLEAR));
    return sigma * (1 - u * u * (3 - 2 * u));
  };
  const commands: string[] = [];
  for (let k = 0; k < frames; k++) {
    const t = offset + k / fps;
    if (t < start - 1e-6) continue;
    if (t >= end) break;
    const v = valueAt(t).toFixed(3);
    // Cả sigmaV: gblur chỉ suy sigmaV từ sigma một lần, đổi mỗi sigma sẽ để lại vệt dọc.
    commands.push(`${f4(Math.max(0, t - 0.001))} gblur@intro sigma ${v}, gblur@intro sigmaV ${v}`);
  }
  const first = valueAt(offset).toFixed(3);
  const send = commands.length ? `,sendcmd=c='${commands.join(";")}'` : "";
  return `${send},gblur@intro=sigma=${first}:sigmaV=${first}:steps=2:enable='lt(t,${f4(end)})'`;
}

/** Mặt nạ tròn khử răng cưa (1 px) trên chính ảnh logo; chạy một lần cho ảnh tĩnh. */
function circleMask(): string {
  const radius = `min(W,H)/2*${CIRCLE_INSET}`;
  return `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*clip(${radius}-hypot(X+0.5-W/2,Y+0.5-H/2)+0.5,0,1)',`;
}

/**
 * Logo ở góc cho một đoạn (input ảnh logo là `[input:v]`), theo thời gian trên timeline.
 * null nếu đoạn kết thúc trước khi logo hiện. Trả về bộ lọc chuẩn bị logo (nhãn [logo]) và phép overlay.
 */
export function logoFilters(
  layout: LogoLayout,
  input: number,
  w: number,
  h: number,
  fps: number,
  offset: number,
  frames: number,
): { prepare: string; overlay: string } | null {
  if (offset + frames / fps <= layout.start_seconds) return null;
  const logoWidth = Math.max(2, Math.round((w * layout.size_percent) / 200) * 2);
  const margin = Math.round((h * layout.margin_percent) / 100);
  const x = layout.position.endsWith("left") ? `${margin}` : `W-w-${margin}`;
  const y = layout.position.startsWith("top") ? `${margin}` : `H-h-${margin}`;
  const mask = layout.shape === "circle" ? circleMask() : "";
  let timing = "";
  if (layout.start_seconds > 0 && offset < layout.start_seconds + LOGO_FADE_IN) {
    // Lặp ảnh theo fps của video cho tới khi hiện hẳn; sau đó overlay giữ khung cuối.
    const loopFrames = Math.ceil((layout.start_seconds + LOGO_FADE_IN + 0.5) * fps);
    timing = `,loop=loop=${loopFrames - 1}:size=1,setpts=N/(${fps})/TB,fade=t=in:st=${f4(layout.start_seconds)}:d=${LOGO_FADE_IN}:alpha=1`;
  }
  return {
    prepare: `[${input}:v]scale=${logoWidth}:-2,format=rgba,${mask}colorchannelmixer=aa=${(layout.opacity_percent / 100).toFixed(3)}${timing}[logo]`,
    overlay: `[pre_logo];[pre_logo][logo]overlay=x=${x}:y=${y}:format=auto`,
  };
}

/** Thu nhỏ tiêu đề dài cho vừa ~90% chiều ngang (chữ trung bình ~0,55 em). */
export function fontSize(text: string, base: number, width: number): number {
  return Math.max(12, Math.min(base, Math.floor((0.9 * width) / (0.55 * Math.max(1, [...text].length)))));
}

/** Chữ một dòng, dạng NFC (dấu tiếng Việt tách rời sẽ bị vẽ thành ký tự riêng). */
export function cleanText(text: string, limit = 100): string {
  return text.normalize("NFC").replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, limit);
}

export function introSizes(intro: IntroConfig, title: string, w: number, h: number) {
  return {
    title: fontSize(title, Math.round(h * 0.075), w),
    subtitle: fontSize(intro.subtitle, Math.round(h * 0.04), w),
    outline: Math.max(1, Math.round(h / 540)),
    shadow: Math.max(1, Math.round(h / 360)),
  };
}

const assTime = (t: number) => {
  const cs = Math.round(Math.max(0, t) * 100);
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};
/** Ký tự đặc biệt của ASS ({ } \) đổi sang ký tự thường để hiện đúng nguyên văn. */
const assText = (s: string) => s.replace(/\\/g, "∖").replace(/\{/g, "(").replace(/\}/g, ")");

/**
 * File phụ đề ASS cho intro, thời gian trên timeline: chữ hiện từ 0,6 s (rõ sau 1 s), tắt trong giây cuối,
 * trắng, viền đen 45%, bóng đen 55% — như intro "title" của Bokin Studio Music.
 */
export function introAss(intro: IntroConfig, title: string, w: number, h: number, font: { name: string; bold: boolean }): string {
  const sz = introSizes(intro, title, w, h);
  const [start, ramp] = TEXT_FADE_IN;
  const fontName = font.name.replace(/,/g, " ");
  const bold = font.bold ? -1 : 0;
  const style = (name: string, size: number) =>
    `Style: ${name},${fontName},${size},&H00FFFFFF,&H00FFFFFF,&H8C000000,&H73000000,${bold},0,0,0,100,100,0,0,1,${sz.outline},${sz.shadow},5,0,0,0,1`;
  const fade = `\\fad(${Math.round(ramp * 1000)},${Math.round(TEXT_FADE_OUT * 1000)})`;
  const line = (styleName: string, y: number, text: string) =>
    `Dialogue: 0,${assTime(start)},${assTime(intro.seconds)},${styleName},,0,0,0,,{\\an5\\pos(${Math.round(w / 2)},${Math.round(y)})${fade}}${assText(text)}`;
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    style("Title", sz.title),
    style("Subtitle", sz.subtitle),
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    line("Title", h * 0.44, title),
    ...(intro.subtitle ? [line("Subtitle", h * 0.58, intro.subtitle)] : []),
    "",
  ].join("\n");
}

/** Độ hiện của chữ (biểu thức FFmpeg theo thời gian trên timeline) cho drawtext — giống hệt Bokin Studio Music. */
function textAlpha(seconds: number): string {
  const [start, ramp] = TEXT_FADE_IN;
  const end = seconds - TEXT_FADE_OUT;
  return `'if(lt(t,${start}),0,if(lt(t,${start + ramp}),(t-${start})/${ramp},if(lt(t,${end}),1,if(lt(t,${seconds}),(${seconds}-t)/${TEXT_FADE_OUT},0))))'`;
}

/** Đoạn [offset, offset + dur) có dính tới chữ của intro không. */
export function overlapsIntroText(intro: IntroConfig, offset: number, dur: number): boolean {
  return intro.enabled && offset < intro.seconds && offset + dur > TEXT_FADE_IN[0];
}

/**
 * Bộ lọc vẽ chữ intro (mốc thời gian của khung = thời gian trên timeline).
 * ASS: libass đọc intro.ass, font trong thư mục làm việc (fontsdir=.).
 * drawtext: đọc intro_title.txt / intro_subtitle.txt và font đã chép vào thư mục làm việc (expansion=none).
 */
export function introText(intro: IntroConfig, title: string, w: number, h: number, mode: TextMode, fontFile: string): string {
  if (mode === "ass") return ",subtitles=intro.ass:fontsdir=.";
  const sz = introSizes(intro, title, w, h);
  const style =
    `fontfile=${fontFile}:expansion=none:fontcolor=white:borderw=${sz.outline}:bordercolor=black@0.45:` +
    `shadowcolor=black@0.55:shadowx=${sz.shadow}:shadowy=${sz.shadow}:x=(w-text_w)/2:alpha=${textAlpha(intro.seconds)}`;
  let chain = `,drawtext=textfile=intro_title.txt:${style}:fontsize=${sz.title}:y=h*0.44-text_h/2`;
  if (intro.subtitle) chain += `,drawtext=textfile=intro_subtitle.txt:${style}:fontsize=${sz.subtitle}:y=h*0.58-text_h/2`;
  return chain;
}

/** Văn bản nhiều dòng (mô tả): NFC, giữ xuống dòng, bỏ ký tự điều khiển khác. */
export function cleanMultiline(text: string, limit = 4000): string {
  return text
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f]+/g, " ")
    .trim()
    .slice(0, limit);
}

/**
 * Thông tin MP4 của một MV, điền tự động từ gợi ý lúc dựng kịch bản:
 * tiêu đề = gợi ý tiêu đề YouTube số 1, mô tả = mô tả YouTube, từ khoá = hashtag trong mô tả, năm = năm dựng.
 * Tên kênh và thể loại là thiết lập chung.
 */
export function mvTags(mv: Pick<MVResult, "youtube_titles" | "youtube_description" | "idea">, meta: VideoMetadata, now = new Date()): Mp4Tags {
  const title = cleanText((mv.youtube_titles ?? []).find((t) => t.trim()) || mv.idea.song_title || mv.idea.world_location, 200);
  const description = cleanMultiline(mv.youtube_description ?? "");
  const tags = [...new Set([...description.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => m[1]))].slice(0, 30);
  // Mô tả không có hashtag (MV tạo trước đây): dùng thể loại + địa điểm làm từ khoá.
  const keywords = tags.length ? tags : [meta.genre, mv.idea.world_location].map((k) => cleanText(k, 100)).filter(Boolean);
  return { title, description, keywords, artist: cleanText(meta.artist, 200), genre: cleanText(meta.genre, 100), year: String(now.getFullYear()) };
}

/** -metadata cho thẻ kiểu iTunes mà Windows Explorer đọc được (tiêu đề, mô tả, tác giả, thể loại, năm, từ khoá). */
export function metadataArgs(tags: Mp4Tags): string[] {
  const pairs: [string, string][] = [
    ["title", tags.title],
    ["artist", tags.artist],
    ["genre", tags.genre],
    ["date", tags.year],
    ["comment", tags.description],
    ["description", tags.description],
    ["keywords", tags.keywords.join(", ")],
  ];
  return pairs.flatMap(([k, v]) => (v.trim() ? ["-metadata", `${k}=${v}`] : []));
}

/** Tên file tải về theo tiêu đề video (bỏ ký tự Windows không cho phép trong tên file). */
export function downloadName(title: string): string {
  const base = cleanText(title, 200)
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/, "")
    .trim()
    .slice(0, 120)
    .trim();
  return `${base || "MV"}.mp4`;
}
