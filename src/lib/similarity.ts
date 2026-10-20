// Đo độ giống nhau giữa các cảnh (dùng cho kiểm tra lặp cảnh và trùng lặp trong series).

const STOPWORDS = new Set(
  `with from into onto over under their there they them this that then than while where when which
  slowly gently softly camera shot frame scene very just each other while toward towards around about
  along across behind front beside between through warm soft light lights lighting golden bright
  style film grain 1950s america cinematic nostalgic mood kodachrome pastel colors vignette 24fps
  young woman man couple early 20s face faces eyes hand hands looks look looking back side
  close medium wide extreme tight shot two-shot track tracking establishing past full moment`
    .split(/\s+/)
    .filter(Boolean),
);

export function tokens(text: string): Set<string> {
  const clean = text
    .toLowerCase()
    .replace(/\{\{[^}]+\}\}/g, " ")
    .replace(/[^a-z\s-]/g, " ");
  const out = new Set<string>();
  for (const w of clean.split(/[\s-]+/)) {
    if (w.length >= 4 && !STOPWORDS.has(w)) out.add(w.replace(/(ing|ed|es|s)$/, ""));
  }
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export function shared(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((x) => b.has(x));
}
