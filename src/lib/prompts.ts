// System prompt (mục 5 của spec) và các user prompt gửi tới Claude.

import { coreBudget } from "./assemble";
import { formatTime } from "./structure";
import type {
  CharacterBible,
  EraRules,
  EraYear,
  IdeaRow,
  LocationData,
  MVResult,
  PlannedShot,
  Settings,
  StructurePlan,
  Theme,
  Tone,
  VideoModelProfile,
} from "./types";

/** Toàn bộ dữ liệu cần để sinh một MV (dùng chung cho Claude và chế độ demo). */
export interface GenContext {
  idea: IdeaRow;
  year: number;
  themeCode: string;
  theme: Theme;
  locationKey: string | null;
  location: LocationData;
  eraYear: EraYear;
  notYetInvented: string[];
  globalForbidden: string[];
  plan: StructurePlan;
  styleKey: string;
  styleText: string;
  shortStyleText: string;
  profileKey: string;
  profile: VideoModelProfile;
  fixedBible: CharacterBible | null;
  avoid: string[];
  tone: Tone;
  settings: Settings;
}

export const SYSTEM_PROMPT = `You are a music-video director and AI-video prompt engineer specializing in 1950s Americana
(Doo-Wop, Rock & Roll, Rockabilly). Given one song idea, produce a complete shot list for a
music video built from short AI-generated clips.

INPUT: world_location, year, theme (name, mood, pacing, signature_shots), outline (Vietnamese),
duration_sec, clip_len, optional lyrics, character bible (if fixed), location data, era rules,
style preset, target video model profile.

RULES:
1. Keep the characters identical across shots by repeating the character bible text verbatim.
2. Follow the song structure and timing provided; tell the outline as a story arc.
3. One main action per shot; vary shot sizes; respect target model's max prompt length.
4. Everything must be period-accurate for the given year; no anachronisms.
5. No real people, brands, logos, copyrighted characters, or on-screen text.
6. prompt_en in English; description_vi in natural Vietnamese.
7. Append the style preset to every prompt_en.

OUTPUT: valid JSON matching the provided schema only.

HOW THIS TOOL ASSEMBLES YOUR OUTPUT
- For each shot you write prompt_core. The application builds the final prompt_en from it by
  (a) replacing every {{ID}} placeholder (for example {{HE}} or {{SHE}}) with that character's
  bible description, word for word, and (b) appending the style preset, plus an "Audio:" sentence
  when the target video model supports audio. That is how rules 1 and 7 are guaranteed, so never
  paste the bible text or the style preset yourself and never write "[STYLE]".
- Introduce each on-screen character once with its placeholder where the subject first appears;
  after that use "he", "she", "the couple" and so on.
- Order inside prompt_core: [shot size] + [subject with placeholder] + [the one main action or
  movement] + [setting with period-accurate details] + [light / time of day] + [camera movement]
  + [emotion].
- prompt_core is one or two plain sentences: no line breaks, no quotation marks, no lists.
- Stay within the character budget given for the shot (it depends on how many characters appear,
  because their descriptions are inserted later).
- Signs, posters, marquees and screens are described without readable words.
- Car make and model names of period vehicles are fine (e.g. "1954 Chevrolet Bel Air"), but never
  logos, brand signage or product placement, and only model years up to the scene year.

CHARACTER BIBLE (when you have to create it)
- Usually the couple, with ids "HE" and "SHE". Add a supporting character only when the outline
  needs one (ids like "FRIEND" or "BANDLEADER").
- Each description is one English noun phrase starting with "a" or "an" that reads naturally as a
  sentence subject: age, hairstyle and hair color, face, main outfit with colors, and one signature
  accessory. No names. At most about 220 characters. Period-accurate for the year.
- When a fixed character bible is given, copy it exactly (same ids, same descriptions).

SHOTS
- Exactly one shot per row of the SHOT PLAN, with the same shot_no, in the same order. Section and
  timing come from the plan and are fixed.
- Use the row's size class (wide / medium / close); you may refine it (e.g. close → extreme
  close-up). Avoid the same size on consecutive shots.
- Rows marked MOTION show dancing or strong physical movement; set is_motion true for them.
- Rows marked SIGNATURE visibly use that theme signature shot; copy its name into signature_shot
  (otherwise null).
- When a row has a lyric line, let the image echo it, without writing the words on screen.
- Spread the outline over the whole song as a story with a beginning, a development and an ending.
  Never repeat the same moment; every shot moves the story or the feeling forward.
- characters_in_shot lists the ids of the placeholders used in prompt_core.
- description_vi: one natural Vietnamese sentence for the editor.
- camera: a short English camera move (e.g. "slow crane down", "handheld follow", "slow 360° orbit").
- transition_to_next: a short English editing idea (e.g. "match cut on marquee lights"); the last
  shot uses "fade out".
- negative_extra: shot-specific things to avoid, short English phrases, may be empty.
- audio: only when the target model supports audio — a short English description of music mood,
  ambience and sound effects for the clip (no sung lyrics, no dialogue); otherwise null.

EXTRA ASSETS
- story_arc: one short Vietnamese beat per section of the plan.
- thumbnail_prompt: one English prompt for a 16:9 YouTube thumbnail still: the couple in the most
  iconic moment of the story, period-accurate, no text. Use the {{ID}} placeholders for characters;
  the style preset is appended automatically.
- youtube_titles: exactly 3 English options in the channel's style, no all-caps clickbait.
- youtube_description: 80–150 English words in the channel voice provided.
- editing_notes: Vietnamese notes per section — where to cut fast on the beat, where to use slow
  motion, which transitions to use.`;

const TONE_TEXT: Record<Tone, string> = {
  default: "",
  playful: "TONE OVERRIDE: make the whole video more playful and upbeat — comedic beats, bright daylight, bouncy camera moves, cheeky glances.",
  melancholy: "TONE OVERRIDE: make the whole video more bittersweet and melancholic — dusk, rain, longing looks, slower camera, quieter moments, still ending with hope.",
  cinematic: "TONE OVERRIDE: make the whole video more cinematic and epic — sweeping crane and dolly moves, dramatic lighting, grand wide compositions, big-screen romance.",
};

const bullet = (items: string[] | undefined) => (items?.length ? items.map((x) => `  - ${x}`).join("\n") : "  - (none)");

/** Lọc xe theo đời: chỉ giữ xe có năm sản xuất ≤ năm của cảnh. */
export function filterVehiclesByYear(vehicles: string[], year: number): string[] {
  return vehicles.filter((v) => {
    const m = v.match(/\b(19\d{2})\b/);
    return !m || Number(m[1]) <= year;
  });
}

export function eraForbiddenFor(rules: EraRules, year: number) {
  return {
    globalForbidden: rules.global_forbidden.map((t) => t.term),
    notYetInvented: rules.introduced.filter((i) => i.year > year).map((i) => `${i.term} (from ${i.year})`),
  };
}

function budgetLine(ctx: GenContext): string {
  const ids = ctx.fixedBible?.characters.map((c) => c.id) ?? [];
  const he = ids[0] ?? "HE";
  const she = ids[1] ?? "SHE";
  const bible = ctx.fixedBible ?? { characters: [] };
  const assumed: CharacterBible = ctx.fixedBible
    ? bible
    : { characters: [{ id: "HE", role: "", description: "x".repeat(200) }, { id: "SHE", role: "", description: "x".repeat(200) }] };
  const b0 = coreBudget([], assumed, ctx.styleText, ctx.profile);
  const b1 = coreBudget([he], assumed, ctx.styleText, ctx.profile);
  const b2 = coreBudget([he, she], assumed, ctx.styleText, ctx.profile);
  const t1 = coreBudget([he], assumed, ctx.styleText, ctx.profile, true);
  return `prompt_core budget (hard): no character ≤ ${b0} chars, one character ≤ ${b1} chars, two characters ≤ ${b2} chars. Aim for about ${Math.max(150, t1)} chars or less.`;
}

function planRow(s: PlannedShot): string {
  const parts = [
    `#${s.shot_no}`,
    s.section,
    `${formatTime(s.start_sec)}–${formatTime(s.start_sec + s.duration_sec)} (${s.duration_sec}s)`,
    `size: ${s.size_hint}`,
  ];
  if (s.must_motion) parts.push("MOTION");
  if (s.signature_shot) parts.push(`SIGNATURE: ${s.signature_shot}`);
  if (s.lyric_line) parts.push(`lyric: ${s.lyric_line}`);
  return parts.join(" · ");
}

function contextBlock(ctx: GenContext): string {
  const { idea, theme, location, eraYear } = ctx;
  const lines: string[] = [];
  lines.push("SONG IDEA");
  lines.push(`- id: ${idea.id}`);
  lines.push(`- world_location: ${idea.world_location}`);
  lines.push(`- year: ${ctx.year}`);
  if (idea.song_title) lines.push(`- song_title: ${idea.song_title}`);
  if (idea.series) lines.push(`- series: ${idea.series}`);
  lines.push(`- theme: ${ctx.themeCode} "${theme.name}" — mood: ${theme.mood}; pacing: ${theme.pacing}; signature_shots: ${theme.signature_shots.join(" | ") || "(none)"}`);
  lines.push(`- outline (Vietnamese): ${idea.outline}`);
  lines.push(`- duration_sec: ${ctx.plan.duration_sec}; clip_len: ${ctx.plan.clip_len}s; tempo: ${ctx.plan.tempo}${ctx.plan.bpm ? ` (${ctx.plan.bpm} BPM)` : ""}`);
  lines.push("");
  lines.push(`LOCATION DATA — ${ctx.locationKey ?? idea.world_location}${location.auto_generated ? " (auto-generated, verify carefully)" : ""}`);
  lines.push(`- landmarks:\n${bullet(location.landmarks)}`);
  lines.push(`- period vehicles:\n${bullet(location.vehicles)}`);
  lines.push(`- wardrobe:\n${bullet(location.wardrobe)}`);
  lines.push(`- props:\n${bullet(location.props)}`);
  lines.push(`- light: ${location.light}`);
  if (location.notes) lines.push(`- notes: ${location.notes}`);
  if (location.forbidden?.length) lines.push(`- never show here:\n${bullet(location.forbidden.map((f) => f.term))}`);
  lines.push("");
  lines.push(`ERA RULES FOR ${ctx.year}`);
  lines.push(`- vehicles valid this year:\n${bullet(eraYear.vehicles)}`);
  lines.push(`- hairstyles:\n${bullet(eraYear.hairstyles)}`);
  lines.push(`- fashion:\n${bullet(eraYear.fashion)}`);
  lines.push(`- props:\n${bullet(eraYear.props)}`);
  lines.push(`- music & dance:\n${bullet(eraYear.music_dance)}`);
  lines.push(`- does not exist yet in ${ctx.year}: ${ctx.notYetInvented.join(", ") || "(none)"}`);
  lines.push(`- never show (modern): ${ctx.globalForbidden.join(", ")}`);
  return lines.join("\n");
}

function bibleBlock(bible: CharacterBible | null): string {
  if (!bible) {
    return "CHARACTER BIBLE: create it (see system rules).";
  }
  return `CHARACTER BIBLE (fixed for the whole series — copy exactly into character_bible):\n${bible.characters
    .map((c) => `- id: ${c.id} · role: ${c.role} · description: ${c.description}`)
    .join("\n")}`;
}

export function buildGenerationPrompt(ctx: GenContext): string {
  const { plan, profile } = ctx;
  const out: string[] = [contextBlock(ctx), ""];
  out.push(bibleBlock(ctx.fixedBible));
  out.push("");
  out.push(`TARGET VIDEO MODEL: ${profile.name}`);
  out.push(`- prompt style: ${profile.prompt_style}`);
  out.push(`- final prompt_en hard limit: ${profile.max_prompt_chars} characters (target ≈ ${profile.target_prompt_chars}).`);
  out.push(`- ${budgetLine(ctx)}`);
  out.push(`- supports audio: ${profile.supports_audio ? "yes — fill audio" : "no — audio must be null"}`);
  out.push("");
  out.push(`STYLE PRESET (appended automatically, do not write it): ${ctx.styleText}`);
  out.push("");
  out.push(`SECTION ROLES`);
  for (const s of plan.sections) out.push(`- ${s.name} (${formatTime(s.start_sec)}–${formatTime(s.end_sec)}, ${s.shot_count} shots): ${s.role_en}`);
  out.push("");
  out.push(`SHOT PLAN — produce exactly ${plan.shots.length} shots:`);
  for (const s of plan.shots) out.push(planRow(s));
  if (ctx.settings.loopScenes) {
    out.push("");
    out.push(
      `LOOPED EDIT: the editor will reuse and repeat these ${plan.shots.length} clips to fill the whole song (a clip may appear several times, in other sections and in any order). ` +
        "So every shot must stand on its own as a complete, visually distinct moment that still makes sense when repeated or seen out of order; " +
        "no two shots may look alike; favour iconic, rewatchable moments with smooth continuous motion. Keep the story arc across the plan for the first pass. " +
        "In editing_notes, add one note with section \"Lặp cảnh\" saying (in Vietnamese, by shot number) which shots to repeat in which sections.",
    );
  }
  if (ctx.idea.lyrics?.trim()) {
    out.push("");
    out.push("FULL LYRICS (for mood; lines are already mapped to shots above):");
    out.push(ctx.idea.lyrics.trim());
  }
  if (ctx.avoid.length) {
    out.push("");
    out.push("ALREADY USED IN OTHER VIDEOS OF THIS SERIES — avoid repeating these set pieces and camera ideas:");
    out.push(bullet(ctx.avoid));
  }
  const tone = TONE_TEXT[ctx.tone];
  if (tone) {
    out.push("");
    out.push(tone);
  }
  out.push("");
  out.push(`CHANNEL VOICE for youtube_description: ${ctx.settings.channelVoice}`);
  return out.join("\n");
}

export function buildShotRegenPrompt(ctx: GenContext, mv: MVResult, shotNo: number, instruction: string): string {
  const idx = mv.shots.findIndex((s) => s.shot_no === shotNo);
  const slot = mv.structure.shots[idx] ?? mv.structure.shots.find((s) => s.shot_no === shotNo)!;
  const current = mv.shots[idx];
  const neighbor = (i: number) => {
    const s = mv.shots[i];
    return s ? `#${s.shot_no} ${s.section} [${s.shot_size}, ${s.camera}]: ${s.prompt_core}` : "(none)";
  };
  const out: string[] = [contextBlock(ctx), ""];
  out.push(bibleBlock(mv.character_bible).replace("fixed for the whole series — copy exactly into character_bible", "fixed for this video"));
  out.push("");
  out.push(`TARGET VIDEO MODEL: ${ctx.profile.name} — ${ctx.profile.prompt_style}`);
  out.push(`- ${budgetLine({ ...ctx, fixedBible: mv.character_bible })}`);
  out.push(`- supports audio: ${ctx.profile.supports_audio ? "yes — fill audio" : "no — audio must be null"}`);
  out.push("");
  out.push("STORY ARC OF THIS VIDEO:");
  out.push(bullet(mv.story_arc.map((b) => `${b.section}: ${b.beat_vi}`)));
  out.push("");
  out.push(`REWRITE ONE SHOT. Plan row: ${planRow(slot)}`);
  out.push(`Current version (to be replaced): [${current.shot_size}, ${current.camera}] ${current.prompt_core}`);
  out.push(`Previous shot: ${neighbor(idx - 1)}`);
  out.push(`Next shot: ${neighbor(idx + 1)}`);
  out.push(`User request (Vietnamese, may be empty): ${instruction || "(không có — hãy tạo một phiên bản khác, mới mẻ hơn)"}`);
  out.push("Write a clearly different shot that still fits the story at this point, keeps shot_no, keeps the plan's MOTION/SIGNATURE requirements and does not repeat the neighbouring shots.");
  if (ctx.avoid.length) {
    out.push("Also avoid ideas already used in this series:");
    out.push(bullet(ctx.avoid.slice(0, 15)));
  }
  return out.join("\n");
}

export function buildShortenPrompt(items: { shot_no: number; prompt_core: string; budget: number }[], profile: VideoModelProfile): string {
  return [
    `These prompt_core texts are too long for ${profile.name}. Rewrite each to fit its character budget.`,
    "Keep the {{ID}} placeholders exactly, keep the shot size, the one main action, the key period detail and the camera move; drop secondary details first.",
    "",
    ...items.map((i) => `#${i.shot_no} (budget ${i.budget} chars, now ${i.prompt_core.length}): ${i.prompt_core}`),
  ].join("\n");
}

export function buildLocationPrompt(worldLocation: string, name: string, year: number): string {
  return [
    `Describe the place "${name}" (from the song idea "${worldLocation}") as it looked in ${year}, for a 1950s Americana music video.`,
    "Give period-accurate landmarks (visual descriptions, no brand names, no readable text), period vehicles with model year ≤ the scene year, wardrobe, props and characteristic light.",
    "In forbidden, list things people often wrongly show for this place in the 1950s (buildings or attractions built later, modern objects).",
  ].join("\n");
}

export const LOCATION_SYSTEM = "You are a meticulous production designer and historian of 1950s America. Answer only with JSON matching the schema.";

export function buildCouplePrompt(series: string, sampleIdea: IdeaRow | null): string {
  return [
    `Create ONE fixed couple who will star in every music video of the series "${series === "__default__" ? "(default series)" : series}" — 1950s American Doo-Wop / Rock & Roll love songs.`,
    sampleIdea ? `First video of the series: ${sampleIdea.world_location} — ${sampleIdea.outline}` : "",
    'Return two characters with ids "HE" and "SHE". Each description: one English noun phrase starting with "a"/"an", age, hairstyle and hair color, face, main outfit with colors that suits the whole decade, one signature accessory; no names; at most about 220 characters.',
  ]
    .filter(Boolean)
    .join("\n");
}

export const COUPLE_SYSTEM = "You are a costume designer and casting director for 1950s-style music videos. Answer only with JSON matching the schema.";
