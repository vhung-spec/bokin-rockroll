// Kiểm tra niên đại (era check) và các quy tắc nội dung bắt buộc của prompt.

import type { CharacterBible, EraRules, ForbiddenTerm, Issue, LocationData } from "./types";

export interface EraContext {
  year: number;
  rules: EraRules;
  location?: LocationData | null;
  allowVehicleMakes?: boolean;
  /** Các đoạn văn cố định (style, mô tả nhân vật) bỏ qua khi kiểm tra từng cảnh. */
  ignoreTexts?: string[];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function termPatterns(t: ForbiddenTerm): string[] {
  if (t.patterns?.length) return t.patterns;
  return [`${escapeRe(t.term).replace(/\s+/g, "[\\s-]+")}(s|es)?`];
}

function compile(pattern: string, caseSensitive = false): RegExp | null {
  try {
    return new RegExp(`(?<![\\w-])(?:${pattern})(?![\\w])`, caseSensitive ? "g" : "gi");
  } catch {
    return null;
  }
}

/** true nếu từ khoá xuất hiện trong ngữ cảnh phủ định ("no smartphones", "without neon"). */
function isNegated(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 40), index);
  const clause = before.split(/[.;:!?]/).pop() ?? "";
  return /\b(no|without|never|not|zero|free of|instead of|avoid(ing)?)\b[^,]*$/i.test(clause);
}

function findAll(text: string, pattern: string, caseSensitive = false): { match: string; index: number }[] {
  const re = compile(pattern, caseSensitive);
  if (!re) return [];
  const out: { match: string; index: number }[] = [];
  for (const m of text.matchAll(re)) {
    if (m.index === undefined) continue;
    if (isNegated(text, m.index)) continue;
    out.push({ match: m[0], index: m.index });
  }
  return out;
}

function stripIgnored(text: string, ignore: string[] = []): string {
  let out = text;
  for (const t of ignore) {
    if (t && t.length > 3) out = out.split(t).join(" ");
  }
  return out;
}

/** Kiểm tra một đoạn prompt tiếng Anh. Trả về danh sách vấn đề (shot_no điền sau). */
export function checkText(raw: string, ctx: EraContext, shotNo: number | null = null): Issue[] {
  const text = stripIgnored(raw, ctx.ignoreTexts);
  const issues: Issue[] = [];
  const push = (i: Omit<Issue, "shot_no">) => {
    if (!issues.some((x) => x.message_vi === i.message_vi)) issues.push({ shot_no: shotNo, ...i });
  };
  const { rules, year } = ctx;

  for (const t of rules.global_forbidden) {
    for (const p of termPatterns(t)) {
      const hit = findAll(text, p, t.case_sensitive)[0];
      if (hit) {
        push({ severity: "error", category: "era", term: hit.match, message_vi: `Sai niên đại: "${hit.match}" (${t.label_vi ?? t.term}) không tồn tại trong thập niên 1950.` });
        break;
      }
    }
  }

  for (const item of rules.introduced) {
    if (year >= item.year) continue;
    for (const p of item.patterns) {
      const hit = findAll(text, p)[0];
      if (hit) {
        push({ severity: "error", category: "era", term: hit.match, message_vi: `Sai niên đại: "${hit.match}" (${item.term}) chỉ có từ năm ${item.year}, cảnh lấy năm ${year}.` });
        break;
      }
    }
  }

  // Xe hơi ghi đời cụ thể: "1957 Chevrolet Bel Air", "'57 Chevy".
  const makes = rules.vehicle_makes.map(escapeRe).join("|");
  const vehicleYears = new Set<number>();
  if (makes) {
    const re = new RegExp(`(?:\\b(19\\d{2})|'(\\d{2}))\\s+(?:${makes})\\b`, "gi");
    for (const m of text.matchAll(re)) {
      const modelYear = m[1] ? Number(m[1]) : 1900 + Number(m[2]);
      vehicleYears.add(modelYear);
      if (modelYear > year) {
        push({ severity: "error", category: "era", term: m[0], message_vi: `Sai niên đại: xe đời ${modelYear} ("${m[0].trim()}") xuất hiện trong cảnh năm ${year}.` });
      }
    }
  }

  // Các năm khác được nhắc tới (không tính dạng thập niên "1950s").
  for (const m of text.matchAll(/\b(19\d{2}|20\d{2})\b(?!s)/g)) {
    const y = Number(m[1]);
    if (y > year && !vehicleYears.has(y)) {
      push({ severity: "warning", category: "era", term: m[1], message_vi: `Prompt nhắc tới năm ${y}, khác năm của cảnh (${year}).` });
    }
  }

  for (const t of ctx.location?.forbidden ?? []) {
    for (const p of termPatterns(t)) {
      const hit = findAll(text, p, t.case_sensitive)[0];
      if (hit) {
        push({ severity: "error", category: "location", term: hit.match, message_vi: `Sai bối cảnh: "${hit.match}" — ${t.reason_vi ?? "không phù hợp với địa điểm/thời kỳ"}.` });
        break;
      }
    }
  }

  for (const name of rules.brands_and_people) {
    const hit = findAll(text, escapeRe(name).replace(/\s+/g, "[\\s-]+") + "(?:'s)?")[0];
    if (hit) push({ severity: "warning", category: "brand", term: hit.match, message_vi: `Có tên thương hiệu/người thật/nhân vật bản quyền: "${hit.match}".` });
  }
  if (ctx.allowVehicleMakes === false && makes) {
    const hit = findAll(text, makes)[0];
    if (hit) push({ severity: "warning", category: "brand", term: hit.match, message_vi: `Có tên hãng xe "${hit.match}" (đang tắt cho phép tên hãng xe).` });
  }

  for (const p of rules.on_screen_text_patterns) {
    const hit = findAll(text, p)[0];
    if (hit) {
      push({ severity: "warning", category: "text", term: hit.match, message_vi: `Có thể xuất hiện chữ trên màn hình: "${hit.match}".` });
      break;
    }
  }
  const quoted = text.match(/["“][^"”]{1,40}["”]/);
  if (quoted) push({ severity: "warning", category: "text", term: quoted[0], message_vi: `Nội dung trong ngoặc kép ${quoted[0]} có thể bị vẽ thành chữ trên màn hình.` });

  return issues;
}

/** Kiểm tra riêng Character Bible một lần (để không báo lặp ở mọi cảnh). */
export function checkBible(bible: CharacterBible, ctx: EraContext): Issue[] {
  const issues: Issue[] = [];
  for (const c of bible.characters) {
    for (const i of checkText(c.description, { ...ctx, ignoreTexts: [] }, null)) {
      issues.push({ ...i, category: "character", message_vi: `Character Bible (${c.id}): ${i.message_vi}` });
    }
  }
  return issues;
}

const VI_DIACRITICS = /[ăâđêôơưàảãáạằẳẵắặầẩẫấậèẻẽéẹềểễếệìỉĩíịòỏõóọồổỗốộờởỡớợùủũúụừửữứựỳỷỹýỵ]/i;

export function hasVietnamese(text: string): boolean {
  return VI_DIACRITICS.test(text);
}
