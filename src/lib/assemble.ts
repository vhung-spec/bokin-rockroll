// Ghép prompt hoàn chỉnh: thay {{HE}}/{{SHE}} bằng Character Bible nguyên văn, thêm style preset ở cuối.

import type { CharacterBible, Shot, VideoModelProfile } from "./types";

const PLACEHOLDER_RE = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;
const STYLE_TOKEN_RE = /\s*\[\s*STYLE\s*\]\s*/gi;

export function placeholdersIn(core: string): string[] {
  return [...new Set([...core.matchAll(PLACEHOLDER_RE)].map((m) => m[1].toUpperCase()))];
}

export function expandCharacters(core: string, bible: CharacterBible): string {
  return core.replace(PLACEHOLDER_RE, (whole, id: string) => {
    const ch = bible.characters.find((c) => c.id.toUpperCase() === id.toUpperCase());
    return ch ? ch.description.trim() : id;
  });
}

function cleanSentence(s: string): string {
  return s.replace(STYLE_TOKEN_RE, " ").replace(/\s+/g, " ").trim();
}

function endWithPeriod(s: string): string {
  const t = s.trim().replace(/[,;:\s]+$/, "");
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

export interface AssembleOptions {
  bible: CharacterBible;
  styleText: string;
  audio?: string | null;
  supportsAudio?: boolean;
}

/** prompt_core → prompt_en (một dòng, kết thúc bằng style preset, thêm "Audio: ..." nếu công cụ hỗ trợ). */
export function assemblePrompt(core: string, opts: AssembleOptions): string {
  const body = endWithPeriod(cleanSentence(expandCharacters(core, opts.bible)));
  let out = `${body} ${endWithPeriod(opts.styleText.trim())}`;
  if (opts.supportsAudio && opts.audio && opts.audio.trim()) {
    out += ` Audio: ${endWithPeriod(cleanSentence(opts.audio))}`;
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Số ký tự còn lại cho phần mô tả cảnh khi đã trừ nhân vật + style (+ audio). */
export function coreBudget(
  characterIds: string[],
  bible: CharacterBible,
  styleText: string,
  profile: VideoModelProfile,
  target = false,
): number {
  const limit = target ? profile.target_prompt_chars : profile.max_prompt_chars;
  const charLen = characterIds.reduce((sum, id) => {
    const ch = bible.characters.find((c) => c.id === id);
    return sum + (ch ? ch.description.length : 0);
  }, 0);
  const audioReserve = profile.supports_audio ? 160 : 0;
  return Math.max(120, limit - charLen - styleText.length - audioReserve - 10);
}

/**
 * Rút gọn cưỡng bức khi LLM đã rút gọn mà vẫn quá dài: dùng style ngắn, rồi cắt phần mô tả cảnh
 * ở ranh giới câu/dấu phẩy. Nhân vật và style luôn được giữ nguyên.
 */
export function forceFit(
  shot: Pick<Shot, "prompt_core" | "audio">,
  opts: AssembleOptions & { shortStyleText?: string; maxChars: number },
): { prompt: string; truncated: boolean } {
  let prompt = assemblePrompt(shot.prompt_core, opts);
  if (prompt.length <= opts.maxChars) return { prompt, truncated: false };
  const style = opts.shortStyleText ?? opts.styleText;
  prompt = assemblePrompt(shot.prompt_core, { ...opts, styleText: style });
  if (prompt.length <= opts.maxChars) return { prompt, truncated: false };

  // Cắt dần mệnh đề cuối của prompt_core.
  let core = shot.prompt_core;
  for (let guard = 0; guard < 40 && prompt.length > opts.maxChars; guard++) {
    const cut = Math.max(core.lastIndexOf(","), core.lastIndexOf("."), core.lastIndexOf(";"));
    if (cut <= 20) break;
    core = core.slice(0, cut);
    prompt = assemblePrompt(core, { ...opts, styleText: style });
  }
  if (prompt.length > opts.maxChars && opts.audio) {
    prompt = assemblePrompt(core, { ...opts, styleText: style, audio: null });
  }
  return { prompt, truncated: true };
}

/** Ghép lại toàn bộ prompt (dùng khi đổi Character Bible hoặc style). Bỏ qua cảnh đã sửa tay. */
export function reassembleShots(shots: Shot[], opts: AssembleOptions & { maxChars?: number; shortStyleText?: string }): Shot[] {
  return shots.map((s) => {
    if (s.edited) return s;
    const fitted = opts.maxChars
      ? forceFit(s, { ...opts, audio: s.audio, maxChars: opts.maxChars })
      : { prompt: assemblePrompt(s.prompt_core, { ...opts, audio: s.audio }) };
    return { ...s, prompt_en: fitted.prompt };
  });
}

export function joinNegative(...parts: (string | string[] | null | undefined)[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const items = Array.isArray(p) ? p : (p ?? "").split(",");
    for (const raw of items) {
      const item = raw.trim();
      const key = item.toLowerCase();
      if (item && !seen.has(key)) {
        seen.add(key);
        out.push(item);
      }
    }
  }
  return out.join(", ");
}

export const BASE_NEGATIVE = [
  "modern cars",
  "smartphones",
  "LED signs",
  "digital screens",
  "modern clothing",
  "text",
  "captions",
  "watermark",
  "logos",
  "distorted faces",
  "extra fingers",
  "deformed hands",
];
