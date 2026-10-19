// Đoán clip nào thuộc cảnh nào khi tải nhiều file một lúc.

const KEYWORD_RE = /(?:shot|scene|c[ảa]nh|clip|sc|#)[\s_.\-#]*0*(\d{1,3})(?!\d)/i;
const STANDALONE_RE = /(?:^|[^\p{L}\d])0*(\d{1,3})(?=$|[^\p{L}\d])/gu;

const stem = (name: string) => name.replace(/\.[a-z0-9]{2,4}$/i, "");

/** Số cảnh ghi trong tên file (vd. "shot-03.mp4", "Cảnh 3.mov", "03_final.mp4"), null nếu không rõ. */
export function shotNumberFromName(name: string, shotNos: number[]): number | null {
  const s = stem(name);
  const k = KEYWORD_RE.exec(s);
  if (k && shotNos.includes(Number(k[1]))) return Number(k[1]);
  for (const m of s.matchAll(STANDALONE_RE)) {
    const n = Number(m[1]);
    if (shotNos.includes(n)) return n;
  }
  return null;
}

export const naturalCompare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/**
 * Gán danh sách file vào các cảnh:
 * 1. File có số cảnh trong tên → vào đúng cảnh đó (thay clip cũ nếu có).
 * 2. File còn lại, xếp theo tên → lần lượt vào các cảnh chưa có clip.
 * Trả về số cảnh cho từng file (null = thừa, không còn cảnh trống).
 */
export function assignClipFiles(names: string[], shotNos: number[], taken: Iterable<number>): (number | null)[] {
  const result: (number | null)[] = names.map(() => null);
  const used = new Set<number>();
  names.forEach((name, i) => {
    const n = shotNumberFromName(name, shotNos);
    if (n !== null && !used.has(n)) {
      result[i] = n;
      used.add(n);
    }
  });
  const busy = new Set([...taken, ...used]);
  const free = [...shotNos].sort((a, b) => a - b).filter((n) => !busy.has(n));
  const rest = names.map((name, i) => ({ name, i })).filter(({ i }) => result[i] === null);
  rest.sort((a, b) => naturalCompare(a.name, b.name));
  for (const { i } of rest) result[i] = free.shift() ?? null;
  return result;
}
