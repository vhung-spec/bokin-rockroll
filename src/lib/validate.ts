// Kiểm tra một MV đã sinh: niên đại, độ dài prompt, style, nhân vật, nhịp dựng, signature shots.

import { checkBible, checkText, hasVietnamese } from "./eraCheck";
import { isChorus } from "./structure";
import { jaccard, tokens } from "./similarity";
import type { EraRules, Issue, MVResult, ShotClass, VideoModelProfile } from "./types";

export function shotClass(size: string): ShotClass {
  const s = size.toLowerCase();
  if (/close|insert|detail|ecu|\bcu\b/.test(s)) return "close";
  if (/wide|full|establishing|long|aerial|ews|\bws\b/.test(s)) return "wide";
  return "medium";
}

const SIZE_VI: Record<ShotClass, string> = { wide: "toàn cảnh", medium: "trung cảnh", close: "cận cảnh" };

export const MOTION_RE =
  /\b(danc\w*|spin\w*|twirl\w*|jitterbug\w*|jiv\w*|swing(s|ing)?|run(s|ning)?|leap\w*|jump\w*|chas\w*|driv\w*|racing|whirl\w*|dips?|lifts?|stomp\w*|bop\w*|rock(s|ing)? and roll\w*|hand jive|cartwheel\w*|skat\w*|sprint\w*)\b/i;

export interface ValidateContext {
  rules: EraRules;
  profile: VideoModelProfile;
  allowVehicleMakes: boolean;
  shortStyleText?: string;
}

export function validateMV(mv: MVResult, ctx: ValidateContext): Issue[] {
  const issues: Issue[] = [];
  const bibleTexts = mv.character_bible.characters.map((c) => c.description);
  const styleTexts = [mv.style_text, ctx.shortStyleText ?? ""].filter(Boolean);
  const eraCtx = {
    year: mv.year,
    rules: ctx.rules,
    location: mv.location,
    allowVehicleMakes: ctx.allowVehicleMakes,
    ignoreTexts: [...bibleTexts, ...styleTexts],
  };

  issues.push(...checkBible(mv.character_bible, eraCtx));

  for (const shot of mv.shots) {
    const n = shot.shot_no;
    issues.push(...checkText(shot.prompt_en, eraCtx, n));

    if (shot.prompt_en.length > ctx.profile.max_prompt_chars) {
      issues.push({
        shot_no: n,
        severity: "error",
        category: "length",
        message_vi: `Prompt dài ${shot.prompt_en.length} ký tự, vượt giới hạn ${ctx.profile.max_prompt_chars} của ${ctx.profile.name}.`,
      });
    }
    if (!styleTexts.some((st) => shot.prompt_en.includes(st.trim()))) {
      issues.push({ shot_no: n, severity: "warning", category: "structure", message_vi: "Prompt thiếu style preset ở cuối." });
    }
    if (hasVietnamese(shot.prompt_en)) {
      issues.push({ shot_no: n, severity: "error", category: "language", message_vi: "Prompt tiếng Anh có chứa tiếng Việt." });
    }
    if (/\{\{|\}\}/.test(shot.prompt_en)) {
      issues.push({ shot_no: n, severity: "error", category: "character", message_vi: "Prompt còn placeholder nhân vật chưa được thay (ví dụ {{HE}})." });
    }
    for (const id of shot.characters_in_shot) {
      const ch = mv.character_bible.characters.find((c) => c.id === id);
      if (ch && !shot.prompt_en.includes(ch.description.trim())) {
        issues.push({
          shot_no: n,
          severity: "warning",
          category: "character",
          message_vi: `Mô tả nhân vật ${id} không còn nguyên văn như Character Bible — nhân vật có thể không nhất quán.`,
        });
      }
    }
  }

  // Luân phiên cỡ cảnh.
  for (let i = 1; i < mv.shots.length; i++) {
    const a = shotClass(mv.shots[i - 1].shot_size);
    const b = shotClass(mv.shots[i].shot_size);
    if (a === b) {
      issues.push({
        shot_no: mv.shots[i].shot_no,
        severity: "info",
        category: "structure",
        message_vi: `Cảnh #${mv.shots[i - 1].shot_no} và #${mv.shots[i].shot_no} cùng là ${SIZE_VI[a]} — nên luân phiên cỡ cảnh.`,
      });
    }
  }

  // Mỗi chorus có ít nhất một cảnh nhảy / chuyển động mạnh.
  const sections = [...new Set(mv.shots.map((s) => s.section))];
  for (const sec of sections.filter(isChorus)) {
    const inSec = mv.shots.filter((s) => s.section === sec);
    const ok = inSec.some((s) => s.is_motion || MOTION_RE.test(s.prompt_core));
    if (!ok) {
      issues.push({ shot_no: null, severity: "warning", category: "structure", message_vi: `Đoạn ${sec} chưa có cảnh nhảy hoặc chuyển động mạnh.` });
    }
  }

  // Signature shots của chủ đề ít nhất 2 lần.
  const sigCount = mv.shots.filter((s) => s.signature_shot).length;
  if (mv.theme.signature_shots.length && sigCount < 2) {
    issues.push({
      shot_no: null,
      severity: "warning",
      category: "structure",
      message_vi: `Signature shots của chủ đề ${mv.theme_code} mới dùng ${sigCount} lần (cần ít nhất 2).`,
    });
  }

  // Không lặp lại một cảnh nhiều lần.
  const toks = mv.shots.map((s) => tokens(s.prompt_core));
  // Mỗi cảnh chỉ báo một lần (so với cảnh giống nó sớm nhất).
  for (let j = 1; j < mv.shots.length; j++) {
    const i = toks.slice(0, j).findIndex((t) => jaccard(t, toks[j]) >= 0.7);
    if (i >= 0) {
      issues.push({
        shot_no: mv.shots[j].shot_no,
        severity: "warning",
        category: "duplicate",
        message_vi: `Cảnh #${mv.shots[j].shot_no} gần giống cảnh #${mv.shots[i].shot_no} — nên đổi hành động hoặc góc máy.`,
      });
    }
  }

  if (mv.thumbnail_prompt) {
    for (const i of checkText(mv.thumbnail_prompt, eraCtx, null)) {
      issues.push({ ...i, message_vi: `Thumbnail: ${i.message_vi}` });
    }
  }

  return issues;
}

export function countIssues(issues: Issue[]) {
  return {
    errors: issues.filter((i) => i.severity === "error").length,
    warnings: issues.filter((i) => i.severity === "warning").length,
  };
}
