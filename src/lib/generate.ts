// Pipeline sinh MV: dựng ngữ cảnh → Claude (hoặc demo) → ghép prompt → kiểm tra → lưu lịch sử.

import { BASE_NEGATIVE, assemblePrompt, coreBudget, forceFit, joinNegative, placeholdersIn, reassembleShots } from "./assemble";
import { findSeriesDuplicates, latestPerIdea, seriesAvoidList, seriesKey } from "./duplicates";
import { addUsage, emptyUsage } from "./cost";
import { LLMError, callStructured, hasCredentials } from "./llm";
import { manualPrompt, parseAnswer, zGenerationLoose, zShotAnswerLoose } from "./manual";
import {
  COUPLE_SCHEMA,
  GENERATION_SCHEMA,
  LOCATION_SCHEMA,
  SHORTEN_SCHEMA,
  SHOT_REGEN_SCHEMA,
  zCouple,
  zGeneration,
  zLocation,
  zShorten,
  zShotRegen,
  type RawGeneration,
  type RawShot,
} from "./llmSchemas";
import { loopNote, mockCouple, mockEditingNotes, mockGenerate, mockLocation, mockShot } from "./mock";
import { baseLocationName, extractYear, matchLocation } from "./parser";
import {
  COUPLE_SYSTEM,
  LOCATION_SYSTEM,
  SYSTEM_PROMPT,
  buildCouplePrompt,
  buildGenerationPrompt,
  buildLocationPrompt,
  buildShortenPrompt,
  buildShotRegenPrompt,
  eraForbiddenFor,
  filterVehiclesByYear,
  type GenContext,
} from "./prompts";
import {
  deleteDraft,
  listMVs,
  loadDraft,
  loadMV,
  newDraftId,
  newMvId,
  readCouples,
  readLibraries,
  readLibrary,
  readSettings,
  saveDraft,
  saveMV,
  upsertLocation,
  withLock,
  writeCouples,
} from "./store";
import { buildStructure, resolveTempo } from "./structure";
import type {
  Character,
  CharacterBible,
  Draft,
  IdeaRow,
  Issue,
  Libraries,
  LocationData,
  MVResult,
  Settings,
  Shot,
  Theme,
  Tone,
  Usage,
} from "./types";
import { validateMV } from "./validate";

/** claude = gọi Claude API · manual = copy/dán với claude.ai · mock = chế độ demo (mẫu có sẵn). */
export type GenMode = "claude" | "mock" | "manual";

export function generationMode(settings: Settings): GenMode {
  if (process.env.MOCK_LLM === "1") return "mock";
  switch (settings.engine) {
    case "demo":
      return "mock";
    case "manual":
      return "manual";
    case "api":
      return "claude";
    default:
      return hasCredentials() ? "claude" : "manual";
  }
}

function assertCanCallApi() {
  if (!hasCredentials()) {
    throw new LLMError("Chưa có API key. Nhập key trong Cài đặt, hoặc chọn chế độ “claude.ai (copy – dán)” để dùng tài khoản claude.ai.", "auth");
  }
}

function priceFor(libs: Libraries, model: string) {
  return libs.pricing?.models?.[model];
}

const note = (severity: Issue["severity"], category: Issue["category"], message_vi: string, shot_no: number | null = null): Issue => ({
  shot_no,
  severity,
  category,
  message_vi,
});

// ---------- Ngữ cảnh ----------

function resolveTheme(idea: IdeaRow, libs: Libraries, notes: Issue[]): { code: string; theme: Theme } {
  const code = idea.theme_code.trim().toUpperCase();
  const found = libs.themes[code];
  if (found) return { code, theme: found };
  notes.push(note("warning", "structure", `Mã chủ đề ${code} chưa có trong thư viện — dùng cấu hình mặc định. Hãy thêm vào Thư viện › Chủ đề.`));
  return {
    code,
    theme: { name: idea.theme_name || code, mood: "romantic, nostalgic, heartfelt", pacing: "mid", signature_shots: [] },
  };
}

function resolveYear(idea: IdeaRow, notes: Issue[]): number {
  const y = extractYear(idea.world_location);
  if (!y) {
    notes.push(note("warning", "era", "Không tìm thấy năm trong world_location — tạm dùng năm 1955."));
    return 1955;
  }
  if (y < 1950 || y > 1959) {
    notes.push(note("warning", "era", `Năm ${y} nằm ngoài 1950–1959; quy tắc niên đại dùng năm gần nhất trong thập niên 1950.`));
  }
  return y;
}

async function inferLocation(
  key: string,
  idea: IdeaRow,
  year: number,
  libs: Libraries,
  settings: Settings,
  mode: GenMode,
  signal?: AbortSignal,
): Promise<LocationData> {
  return withLock(`infer:${key.toLowerCase()}`, async () => {
    const current = await readLibrary("locations");
    if (current[key]) return current[key];
    const eraYear = libs.eraRules.years[String(Math.min(1959, Math.max(1950, year)))];
    const raw =
      mode !== "claude"
        ? mockLocation(key, year, eraYear)
        : (
            await callStructured({
              settings,
              system: LOCATION_SYSTEM,
              user: buildLocationPrompt(idea.world_location, key, year),
              schema: LOCATION_SCHEMA,
              validator: zLocation,
              maxTokens: 16000,
              signal,
              price: priceFor(libs, settings.model),
            })
          ).data;
    const loc: LocationData = { region: "Tự sinh", aliases: [], ...raw, auto_generated: true };
    await upsertLocation(key, loc);
    return loc;
  });
}

function normalizeBible(chars: Character[]): CharacterBible {
  const seen = new Set<string>();
  const characters: Character[] = [];
  for (const c of chars) {
    const id = c.id.replace(/[{}\s]/g, "").toUpperCase();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    characters.push({ ...c, id, description: c.description.trim().replace(/[.\s]+$/, "") });
  }
  return { characters };
}

/** Cặp đôi dùng chung cho cả series (tạo một lần, lưu vào data/couples.json). */
export async function ensureSeriesCouple(
  idea: IdeaRow,
  settings: Settings,
  mode: GenMode,
  signal?: AbortSignal,
): Promise<CharacterBible | null> {
  const key = seriesKey(idea.series);
  return withLock(`couple:${key}`, async () => {
    const couples = await readCouples();
    if (couples[key]?.characters?.length) return normalizeBible(couples[key].characters);
    // Chế độ claude.ai: cặp đôi được lấy từ MV đầu tiên của series khi hoàn tất.
    if (mode === "manual") return null;
    const characters =
      mode === "mock"
        ? mockCouple(key)
        : (
            await callStructured({
              settings,
              system: COUPLE_SYSTEM,
              user: buildCouplePrompt(key, idea),
              schema: COUPLE_SCHEMA,
              validator: zCouple,
              maxTokens: 16000,
              signal,
            })
          ).data.characters;
    const bible = normalizeBible(characters);
    await writeCouples({ ...(await readCouples()), [key]: { characters: bible.characters, created_at: new Date().toISOString() } });
    return bible;
  });
}

interface BuildContextOptions {
  tone: Tone;
  mode: GenMode;
  signal?: AbortSignal;
  history: MVResult[];
}

async function buildContext(
  idea: IdeaRow,
  settings: Settings,
  libs: Libraries,
  opts: BuildContextOptions,
): Promise<{ ctx: GenContext; notes: Issue[] }> {
  const notes: Issue[] = [];
  const { code, theme } = resolveTheme(idea, libs, notes);
  const year = resolveYear(idea, notes);
  const eraKey = String(Math.min(1959, Math.max(1950, year)));
  const eraYear = libs.eraRules.years[eraKey] ?? { vehicles: [], hairstyles: [], fashion: [], props: [], music_dance: [] };

  let locationKey = matchLocation(idea.world_location, libs.locations);
  let location: LocationData;
  if (locationKey) {
    location = libs.locations[locationKey];
  } else {
    locationKey = baseLocationName(idea.world_location) || idea.world_location;
    location = await inferLocation(locationKey, idea, year, libs, settings, opts.mode, opts.signal);
    notes.push(note("info", "location", `Địa điểm "${locationKey}" chưa có trong thư viện — đã tự suy luận và lưu (auto_generated) để bạn duyệt trong Thư viện.`));
  }
  if (location.auto_generated) {
    notes.push(note("info", "location", `Dữ liệu địa điểm "${locationKey}" là tự sinh, chưa được duyệt.`));
  }
  location = { ...location, vehicles: filterVehiclesByYear(location.vehicles, year) };

  const profileKey = libs.videoModels[settings.videoModel] ? settings.videoModel : Object.keys(libs.videoModels)[0];
  const profile = libs.videoModels[profileKey];
  const styleKey = libs.styles[settings.stylePreset] ? settings.stylePreset : Object.keys(libs.styles)[0];
  const style = libs.styles[styleKey];
  const clipLen = settings.clipLen ?? profile.default_clip_len;

  const plan = buildStructure({
    durationSec: idea.duration_sec ?? settings.defaultDuration,
    clipLen,
    tempo: resolveTempo(idea, theme),
    bpm: idea.bpm ?? null,
    maxShots: settings.maxShots,
    minShots: settings.minShots,
    sections: settings.songStructure,
    lyrics: idea.lyrics,
    signatureShots: theme.signature_shots,
  });

  const fixedBible = settings.fixedCouple ? await ensureSeriesCouple(idea, settings, opts.mode, opts.signal) : null;
  if (settings.fixedCouple && !fixedBible) {
    notes.push(note("info", "character", `Series “${idea.series || "mặc định"}” chưa có cặp đôi cố định — Character Bible của MV này sẽ được lưu làm cặp đôi cho cả series.`));
  }
  const key = seriesKey(idea.series);
  const others = latestPerIdea(opts.history.filter((m) => seriesKey(m.idea.series) === key && m.idea.id !== idea.id));
  const { globalForbidden, notYetInvented } = eraForbiddenFor(libs.eraRules, year);

  return {
    ctx: {
      idea,
      year,
      themeCode: code,
      theme,
      locationKey,
      location,
      eraYear,
      notYetInvented,
      globalForbidden,
      plan,
      styleKey,
      styleText: style.text,
      shortStyleText: style.short ?? style.text,
      profileKey,
      profile,
      fixedBible,
      avoid: seriesAvoidList(others),
      tone: opts.tone,
      settings,
    },
    notes,
  };
}

/** Dựng lại ngữ cảnh cho một MV đã có (dùng khi sinh lại một cảnh). */
async function contextFromMV(mv: MVResult, settings: Settings, libs: Libraries, history: MVResult[]): Promise<GenContext> {
  const profileKey = libs.videoModels[mv.video_model] ? mv.video_model : settings.videoModel;
  const eraKey = String(Math.min(1959, Math.max(1950, mv.year)));
  const { globalForbidden, notYetInvented } = eraForbiddenFor(libs.eraRules, mv.year);
  const key = seriesKey(mv.idea.series);
  const style = libs.styles[mv.style_key];
  return {
    idea: mv.idea,
    year: mv.year,
    themeCode: mv.theme_code,
    theme: mv.theme,
    locationKey: mv.location_key,
    location: mv.location,
    eraYear: libs.eraRules.years[eraKey] ?? { vehicles: [], hairstyles: [], fashion: [], props: [], music_dance: [] },
    notYetInvented,
    globalForbidden,
    plan: mv.structure,
    styleKey: mv.style_key,
    styleText: mv.style_text,
    shortStyleText: style?.short ?? mv.style_text,
    profileKey,
    profile: libs.videoModels[profileKey],
    fixedBible: mv.character_bible,
    avoid: seriesAvoidList(latestPerIdea(history.filter((m) => m.id !== mv.id && seriesKey(m.idea.series) === key && m.idea.id !== mv.idea.id))),
    tone: mv.tone,
    settings,
  };
}

// ---------- Ghép & làm sạch ----------

const STYLE_TOKEN = /\[\s*STYLE\s*\]/gi;

function cleanCore(core: string, ctx: GenContext, bible: CharacterBible): string {
  let c = core.replace(STYLE_TOKEN, " ").replace(/\s+/g, " ").trim();
  for (const st of [ctx.styleText, ctx.shortStyleText]) if (st) c = c.split(st).join(" ");
  const ids = new Set(bible.characters.map((x) => x.id));
  c = c.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g, (_, id: string) => {
    const up = id.toUpperCase();
    return ids.has(up) ? `{{${up}}}` : id.toLowerCase();
  });
  return c.replace(/\s+([,.])/g, "$1").replace(/\s+/g, " ").trim();
}

function toShot(raw: RawShot, slot: GenContext["plan"]["shots"][number], ctx: GenContext, bible: CharacterBible): Shot {
  const core = cleanCore(raw.prompt_core, ctx, bible);
  const audio = ctx.profile.supports_audio ? raw.audio?.trim() || null : null;
  return {
    shot_no: slot.shot_no,
    section: slot.section,
    start_sec: slot.start_sec,
    duration_sec: slot.duration_sec,
    description_vi: raw.description_vi.trim(),
    prompt_core: core,
    prompt_en: assemblePrompt(core, { bible, styleText: ctx.styleText, audio, supportsAudio: ctx.profile.supports_audio }),
    camera: raw.camera.trim(),
    shot_size: raw.shot_size.trim() || slot.size_hint,
    characters_in_shot: placeholdersIn(core).filter((id) => bible.characters.some((c) => c.id === id)),
    lyric_line: slot.lyric_line,
    negative_prompt: joinNegative(BASE_NEGATIVE, [`cars made after ${ctx.year}`], raw.negative_extra),
    transition_to_next: raw.transition_to_next.trim(),
    audio,
    signature_shot: raw.signature_shot?.trim() || slot.signature_shot,
    is_motion: raw.is_motion || slot.must_motion,
  };
}

/** Rút gọn các prompt vượt giới hạn: nhờ Claude viết gọn lại, nếu vẫn dài thì cắt cưỡng bức. */
async function fitLengths(
  shots: Shot[],
  ctx: GenContext,
  bible: CharacterBible,
  mode: GenMode,
  notes: Issue[],
  usage: Usage,
  signal?: AbortSignal,
  libs?: Libraries,
): Promise<Shot[]> {
  const max = ctx.profile.max_prompt_chars;
  const over = shots.filter((s) => s.prompt_en.length > max);
  if (!over.length) return shots;
  const byNo = new Map(shots.map((s) => [s.shot_no, { ...s }]));

  if (mode === "claude") {
    const items = over.map((s) => ({ shot_no: s.shot_no, prompt_core: s.prompt_core, budget: coreBudget(s.characters_in_shot, bible, ctx.styleText, ctx.profile) }));
    try {
      const res = await callStructured({
        settings: ctx.settings,
        system: SYSTEM_PROMPT,
        user: buildShortenPrompt(items, ctx.profile),
        schema: SHORTEN_SCHEMA,
        validator: zShorten,
        maxTokens: 32000,
        signal,
        price: libs ? priceFor(libs, ctx.settings.model) : undefined,
      });
      addUsage(usage, res.usage);
      for (const r of res.data.shots) {
        const s = byNo.get(r.shot_no);
        if (!s) continue;
        s.prompt_core = cleanCore(r.prompt_core, ctx, bible);
        s.characters_in_shot = placeholdersIn(s.prompt_core).filter((id) => bible.characters.some((c) => c.id === id));
        s.prompt_en = assemblePrompt(s.prompt_core, { bible, styleText: ctx.styleText, audio: s.audio, supportsAudio: ctx.profile.supports_audio });
      }
    } catch (err) {
      if (err instanceof LLMError && err.kind === "aborted") throw err;
      notes.push(note("warning", "length", `Không rút gọn được bằng Claude (${(err as Error).message}); đã cắt bớt tự động.`));
    }
  }

  for (const s of byNo.values()) {
    if (s.prompt_en.length <= max) continue;
    const fitted = forceFit(s, {
      bible,
      styleText: ctx.styleText,
      shortStyleText: ctx.shortStyleText,
      supportsAudio: ctx.profile.supports_audio,
      audio: s.audio,
      maxChars: max,
    });
    s.prompt_en = fitted.prompt;
    notes.push(note("info", "length", `Cảnh #${s.shot_no}: prompt được rút gọn tự động để vừa giới hạn ${max} ký tự.`, s.shot_no));
  }
  return shots.map((s) => byNo.get(s.shot_no)!);
}

function finalizeIssues(mv: MVResult, settings: Settings, libs: Libraries, history: MVResult[]): MVResult {
  const profile = libs.videoModels[mv.video_model] ?? Object.values(libs.videoModels)[0];
  const style = libs.styles[mv.style_key];
  const validation = validateMV(mv, {
    rules: libs.eraRules,
    profile,
    allowVehicleMakes: settings.allowVehicleMakes,
    shortStyleText: style?.short,
  });
  const duplicates = findSeriesDuplicates(mv, history);
  const dupIssues = duplicates.map((d) => note("warning", "duplicate", d.suggestion_vi));
  return { ...mv, issues: [...mv.generation_notes, ...validation, ...dupIssues], duplicates };
}

/** Chế độ lặp cảnh: đảm bảo luôn có ghi chú "Lặp cảnh" (Claude có thể quên). */
function withLoopNote(notes: { section: string; note_vi: string }[], ctx: GenContext) {
  if (!ctx.settings.loopScenes || notes.some((n) => /lặp/i.test(n.section))) return notes;
  return [...notes, loopNote(ctx.plan)];
}

// ---------- API chính ----------

export interface GenerateOptions {
  tone?: Tone;
  signal?: AbortSignal;
}

interface Prepared {
  settings: Settings;
  libs: Libraries;
  history: MVResult[];
  mode: GenMode;
  ctx: GenContext;
  notes: Issue[];
}

async function prepare(idea: IdeaRow, tone: Tone, signal?: AbortSignal, modeOverride?: GenMode): Promise<Prepared> {
  const settings = await readSettings();
  const libs = await readLibraries();
  const mode = modeOverride ?? generationMode(settings);
  if (mode === "claude") assertCanCallApi();
  const history = await listMVs();
  const { ctx, notes } = await buildContext(idea, settings, libs, { tone, mode, signal, history });
  return { settings, libs, history, mode, ctx, notes };
}

/** Ghép kết quả thô (từ Claude API, claude.ai hoặc demo) thành MV hoàn chỉnh, kiểm tra và lưu. */
async function finalize(prep: Prepared, raw: RawGeneration, usage: Usage, signal?: AbortSignal): Promise<MVResult> {
  const { settings, libs, history, mode, ctx, notes } = prep;
  const idea = ctx.idea;

  // Character Bible: cặp đôi cố định luôn thắng; giữ thêm nhân vật phụ nếu có.
  let bible = normalizeBible(raw.character_bible);
  if (ctx.fixedBible) {
    const fixedIds = new Set(ctx.fixedBible.characters.map((c) => c.id));
    bible = { characters: [...ctx.fixedBible.characters, ...bible.characters.filter((c) => !fixedIds.has(c.id))] };
  }
  if (!bible.characters.length) {
    bible = normalizeBible(mockCouple(idea.id));
    notes.push(note("warning", "character", "Claude không trả về Character Bible — đã dùng cặp đôi mẫu."));
  }

  const got = raw.shots.length;
  const expected = ctx.plan.shots.length;
  if (mode === "manual" && got !== expected) {
    notes.push(note("warning", "structure", `Câu trả lời có ${got}/${expected} cảnh${got > expected ? " — đã bỏ các cảnh thừa" : ""}.`));
  }
  let shots = ctx.plan.shots.map((slot, i) => {
    const r = raw.shots.find((s) => s.shot_no === slot.shot_no) ?? raw.shots[i];
    if (!r) {
      notes.push(note("warning", "structure", `Cảnh #${slot.shot_no} bị thiếu trong kết quả — đã điền cảnh mẫu, nên bấm "Sinh lại cảnh này".`, slot.shot_no));
      return toShot(mockShot(ctx, slot), slot, ctx, bible);
    }
    return toShot(r, slot, ctx, bible);
  });
  shots = await fitLengths(shots, ctx, bible, mode, notes, usage, signal, libs);

  const titles = raw.youtube_titles.filter(Boolean).slice(0, 3);
  const now = new Date().toISOString();
  let mv: MVResult = {
    id: newMvId(),
    created_at: now,
    updated_at: now,
    idea,
    year: ctx.year,
    location_key: ctx.locationKey,
    location: ctx.location,
    theme_code: ctx.themeCode,
    theme: ctx.theme,
    tone: ctx.tone,
    generator: mode,
    model: mode === "mock" ? "demo" : mode === "manual" ? "claude.ai" : settings.model,
    video_model: ctx.profileKey,
    style_key: ctx.styleKey,
    style_text: ctx.styleText,
    character_bible: bible,
    story_arc: raw.story_arc.length ? raw.story_arc : mockGenerate(ctx).story_arc,
    structure: ctx.plan,
    shots,
    thumbnail_prompt: raw.thumbnail_prompt
      ? assemblePrompt(`${cleanCore(raw.thumbnail_prompt, ctx, bible)}, 16:9 YouTube thumbnail composition`, { bible, styleText: ctx.styleText })
      : "",
    youtube_titles: titles.length >= 3 ? titles : [...titles, ...mockGenerate(ctx).youtube_titles].slice(0, 3),
    youtube_description: raw.youtube_description,
    editing_notes: withLoopNote(raw.editing_notes.length ? raw.editing_notes : mockEditingNotes(ctx.plan), ctx),
    generation_notes: notes,
    issues: [],
    duplicates: [],
    usage,
  };
  mv = finalizeIssues(mv, settings, libs, history);
  await saveMV(mv);

  // claude.ai: series chưa có cặp đôi cố định → lấy cặp đôi của MV này.
  if (settings.fixedCouple && !ctx.fixedBible) {
    const key = seriesKey(idea.series);
    await withLock(`couple:${key}`, async () => {
      const couples = await readCouples();
      if (!couples[key]?.characters?.length) {
        await writeCouples({ ...couples, [key]: { characters: bible.characters.slice(0, 2), created_at: now } });
      }
    });
  }
  return mv;
}

/** Sinh một MV bằng Claude API hoặc chế độ demo. (Chế độ claude.ai dùng createDrafts.) */
export async function generateMV(idea: IdeaRow, opts: GenerateOptions = {}): Promise<MVResult> {
  const prep = await prepare(idea, opts.tone ?? "default", opts.signal);
  if (prep.mode === "manual") throw new Error("Đang ở chế độ claude.ai — hãy tạo bản nháp (createDrafts) thay vì gọi API.");
  const usage = emptyUsage();

  let raw: RawGeneration;
  if (prep.mode === "mock") {
    raw = mockGenerate(prep.ctx);
    prep.notes.push(note("info", "structure", "Chế độ demo: nội dung được ghép từ mẫu có sẵn, không dùng Claude. Nhập API key hoặc dùng chế độ claude.ai để sinh bằng AI."));
  } else {
    const expected = prep.ctx.plan.shots.length;
    const res = await callStructured({
      settings: prep.settings,
      system: SYSTEM_PROMPT,
      user: buildGenerationPrompt(prep.ctx),
      schema: GENERATION_SCHEMA,
      validator: zGeneration,
      check: (d) => (d.shots.length !== expected ? `Expected exactly ${expected} shots (one per plan row), got ${d.shots.length}.` : null),
      signal: opts.signal,
      price: priceFor(prep.libs, prep.settings.model),
    });
    raw = res.data;
    addUsage(usage, res.usage);
  }
  return finalize(prep, raw, usage, opts.signal);
}

// ---------- Chế độ claude.ai (copy yêu cầu → dán câu trả lời) ----------

export async function createDrafts(ideas: IdeaRow[], tone: Tone = "default"): Promise<Draft[]> {
  const out: Draft[] = [];
  for (const idea of ideas) {
    const draft: Draft = { id: newDraftId(), created_at: new Date(Date.now() + out.length).toISOString(), idea, tone };
    await saveDraft(draft);
    out.push(draft);
  }
  return out;
}

async function loadDraftOrThrow(id: string): Promise<Draft> {
  const d = await loadDraft(id);
  if (!d) throw new Error("Không tìm thấy bản nháp.");
  return d;
}

/**
 * Tạo yêu cầu (một tin nhắn) để dán vào claude.ai. Ngữ cảnh được lưu vào bản nháp để câu trả lời
 * được ghép đúng theo kế hoạch cảnh đã gửi (kể cả khi đổi cài đặt sau đó).
 */
export async function buildDraftPrompt(id: string): Promise<{ prompt: string; draft: Draft }> {
  const draft = await loadDraftOrThrow(id);
  const prep = await prepare(draft.idea, draft.tone, undefined, "manual");
  const expected = prep.ctx.plan.shots.length;
  const prompt = manualPrompt(SYSTEM_PROMPT, buildGenerationPrompt(prep.ctx), GENERATION_SCHEMA, [
    `Include all ${expected} shots, in order. Do not shorten or skip any field.`,
  ]);
  const updated: Draft = { ...draft, ctx: prep.ctx, notes: prep.notes, prompt_built_at: new Date().toISOString(), prompt_chars: prompt.length };
  await saveDraft(updated);
  return { prompt, draft: updated };
}

/** Nhận câu trả lời của claude.ai (văn bản dán vào) → MV hoàn chỉnh; xoá bản nháp. */
export async function completeDraft(id: string, answer: string): Promise<MVResult> {
  const draft = await loadDraftOrThrow(id);
  if (!draft.ctx) throw new Error("Hãy bấm “Copy yêu cầu” và gửi cho Claude trước, rồi mới dán câu trả lời.");
  const raw = parseAnswer(answer, zGenerationLoose) as RawGeneration;
  const prep: Prepared = {
    settings: await readSettings(),
    libs: await readLibraries(),
    history: await listMVs(),
    mode: "manual",
    ctx: draft.ctx as GenContext,
    notes: [...(draft.notes ?? []), note("info", "structure", "Nội dung tạo bằng claude.ai (copy – dán), không tốn phí API.")],
  };
  const mv = await finalize(prep, raw, emptyUsage());
  await deleteDraft(id);
  return mv;
}

// ---------- Sinh lại một cảnh ----------

async function loadOrThrow(id: string): Promise<MVResult> {
  const mv = await loadMV(id);
  if (!mv) throw new Error("Không tìm thấy MV.");
  return mv;
}

async function shotContext(id: string, shotNo: number) {
  const mv = await loadOrThrow(id);
  const settings = await readSettings();
  const libs = await readLibraries();
  const history = await listMVs();
  const idx = mv.shots.findIndex((s) => s.shot_no === shotNo);
  if (idx === -1) throw new Error(`Không có cảnh #${shotNo}.`);
  const ctx = await contextFromMV(mv, settings, libs, history);
  return { mv, settings, libs, history, idx, slot: mv.structure.shots[idx], ctx };
}

async function applyRawShot(
  sc: Awaited<ReturnType<typeof shotContext>>,
  raw: RawShot,
  mode: GenMode,
  usage: Usage,
  signal?: AbortSignal,
): Promise<MVResult> {
  const { mv, idx, slot, ctx, settings, libs, history } = sc;
  const notes = mv.generation_notes.filter((n) => n.shot_no !== slot.shot_no);
  let [shot] = await fitLengths([toShot(raw, slot, ctx, mv.character_bible)], ctx, mv.character_bible, mode, notes, usage, signal, libs);
  shot = { ...shot, edited: false };
  const shots = mv.shots.map((s, i) => (i === idx ? shot : s));
  const updated = finalizeIssues({ ...mv, shots, generation_notes: notes, usage, updated_at: new Date().toISOString() }, settings, libs, history);
  await saveMV(updated);
  return updated;
}

export async function regenerateShot(id: string, shotNo: number, instruction: string, signal?: AbortSignal): Promise<MVResult> {
  const sc = await shotContext(id, shotNo);
  const mode = generationMode(sc.settings);
  if (mode === "manual") throw new Error("Đang ở chế độ claude.ai — hãy copy yêu cầu sinh lại cảnh và dán câu trả lời.");
  const usage = { ...emptyUsage(), ...(sc.mv.usage ?? {}) };

  let raw: RawShot;
  if (mode === "mock") {
    // Thử vài biến thể cho tới khi khác cảnh hiện tại.
    const base = (Date.now() % 997) + 1;
    raw = mockShot(sc.ctx, sc.slot, base);
    for (let k = 1; k < 12 && cleanCore(raw.prompt_core, sc.ctx, sc.mv.character_bible) === sc.mv.shots[sc.idx].prompt_core; k++) {
      raw = mockShot(sc.ctx, sc.slot, base + k);
    }
  } else {
    assertCanCallApi();
    const res = await callStructured({
      settings: sc.settings,
      system: SYSTEM_PROMPT,
      user: buildShotRegenPrompt(sc.ctx, sc.mv, shotNo, instruction),
      schema: SHOT_REGEN_SCHEMA,
      validator: zShotRegen,
      maxTokens: 32000,
      signal,
      price: priceFor(sc.libs, sc.settings.model),
    });
    raw = res.data.shot;
    addUsage(usage, res.usage);
  }
  return applyRawShot(sc, raw, mode, usage, signal);
}

/** Chế độ claude.ai: yêu cầu sinh lại một cảnh (để copy). */
export async function shotRegenManualPrompt(id: string, shotNo: number, instruction: string): Promise<string> {
  const sc = await shotContext(id, shotNo);
  return manualPrompt(SYSTEM_PROMPT, buildShotRegenPrompt(sc.ctx, sc.mv, shotNo, instruction), SHOT_REGEN_SCHEMA, [`Keep "shot_no": ${shotNo}.`]);
}

/** Chế độ claude.ai: dán câu trả lời sinh lại cảnh. */
export async function applyShotAnswer(id: string, shotNo: number, answer: string): Promise<MVResult> {
  const sc = await shotContext(id, shotNo);
  const raw = parseAnswer(answer, zShotAnswerLoose) as RawShot;
  return applyRawShot(sc, { ...raw, shot_no: shotNo }, "manual", { ...emptyUsage(), ...(sc.mv.usage ?? {}) });
}

export type ShotPatch = Partial<
  Pick<Shot, "prompt_en" | "description_vi" | "camera" | "shot_size" | "negative_prompt" | "transition_to_next" | "lyric_line">
> & { resetEdit?: boolean };

export async function updateShot(id: string, shotNo: number, patch: ShotPatch): Promise<MVResult> {
  const mv = await loadOrThrow(id);
  const settings = await readSettings();
  const libs = await readLibraries();
  const profile = libs.videoModels[mv.video_model];
  const shots = mv.shots.map((s) => {
    if (s.shot_no !== shotNo) return s;
    const { resetEdit, ...fields } = patch;
    if (resetEdit) {
      return {
        ...s,
        edited: false,
        prompt_en: assemblePrompt(s.prompt_core, { bible: mv.character_bible, styleText: mv.style_text, audio: s.audio, supportsAudio: profile?.supports_audio }),
      };
    }
    const next = { ...s, ...fields };
    if (fields.prompt_en !== undefined && fields.prompt_en.trim() !== s.prompt_en) {
      next.prompt_en = fields.prompt_en.replace(/\s*\n\s*/g, " ").trim();
      next.edited = true;
      // Nhân vật còn trong cảnh: mô tả còn nguyên văn, hoặc còn một phần (để vẫn cảnh báo nếu bị sửa dở).
      next.characters_in_shot = mv.character_bible.characters
        .filter((c) => next.prompt_en.includes(c.description) || next.prompt_en.includes(c.description.slice(0, 30)))
        .map((c) => c.id);
    }
    return next;
  });
  const updated = finalizeIssues({ ...mv, shots, updated_at: new Date().toISOString() }, settings, libs, await listMVs());
  await saveMV(updated);
  return updated;
}

/** Sửa Character Bible → ghép lại mọi prompt (trừ cảnh đã sửa tay) để giữ nhân vật nhất quán. */
export async function updateBible(id: string, characters: Character[], saveAsSeriesCouple = false): Promise<MVResult> {
  const mv = await loadOrThrow(id);
  const settings = await readSettings();
  const libs = await readLibraries();
  const bible = normalizeBible(characters);
  const profile = libs.videoModels[mv.video_model];
  const style = libs.styles[mv.style_key];
  const shots = reassembleShots(mv.shots, {
    bible,
    styleText: mv.style_text,
    supportsAudio: profile?.supports_audio,
    maxChars: profile?.max_prompt_chars,
    shortStyleText: style?.short,
  });
  if (saveAsSeriesCouple) {
    const couples = await readCouples();
    await writeCouples({ ...couples, [seriesKey(mv.idea.series)]: { characters: bible.characters, created_at: new Date().toISOString() } });
  }
  const updated = finalizeIssues({ ...mv, character_bible: bible, shots, updated_at: new Date().toISOString() }, settings, libs, await listMVs());
  await saveMV(updated);
  return updated;
}

/** Đổi style preset của MV → ghép lại prompt. */
export async function changeStyle(id: string, styleKey: string): Promise<MVResult> {
  const mv = await loadOrThrow(id);
  const settings = await readSettings();
  const libs = await readLibraries();
  const style = libs.styles[styleKey];
  if (!style) throw new Error("Không có style preset này.");
  const profile = libs.videoModels[mv.video_model];
  const shots = reassembleShots(mv.shots, {
    bible: mv.character_bible,
    styleText: style.text,
    supportsAudio: profile?.supports_audio,
    maxChars: profile?.max_prompt_chars,
    shortStyleText: style.short,
  });
  const thumbCore = mv.thumbnail_prompt.split(mv.style_text).join("").trim();
  const updated = finalizeIssues(
    {
      ...mv,
      style_key: styleKey,
      style_text: style.text,
      shots,
      thumbnail_prompt: thumbCore ? `${thumbCore.replace(/[.\s]+$/, "")}. ${style.text}.` : "",
      updated_at: new Date().toISOString(),
    },
    settings,
    libs,
    await listMVs(),
  );
  await saveMV(updated);
  return updated;
}

/** Ghép lại ảnh tham chiếu nhân vật (đường dẫn file) vào Character Bible. */
export async function setReferenceImages(id: string, characterId: string, paths: string[]): Promise<MVResult> {
  const mv = await loadOrThrow(id);
  const characters = mv.character_bible.characters.map((c) => (c.id === characterId ? { ...c, reference_images: paths } : c));
  const updated = { ...mv, character_bible: { characters }, updated_at: new Date().toISOString() };
  await saveMV(updated);
  return updated;
}

/** Kiểm tra lại toàn bộ (sau khi sửa thư viện / quy tắc niên đại). */
export async function recheckMV(id: string): Promise<MVResult> {
  const mv = await loadOrThrow(id);
  const updated = finalizeIssues(mv, await readSettings(), await readLibraries(), await listMVs());
  await saveMV(updated);
  return updated;
}

export async function importMVs(mvs: MVResult[]): Promise<MVResult[]> {
  const settings = await readSettings();
  const libs = await readLibraries();
  const history = await listMVs();
  const out: MVResult[] = [];
  for (const m of mvs) {
    const now = new Date().toISOString();
    const mv = finalizeIssues(
      { ...m, id: newMvId(), generation_notes: m.generation_notes ?? [], duplicates: [], issues: [], updated_at: now, created_at: m.created_at ?? now },
      settings,
      libs,
      [...history, ...out],
    );
    await saveMV(mv);
    out.push(mv);
  }
  return out;
}
