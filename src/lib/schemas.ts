// zod schema kiểm tra dữ liệu người dùng gửi lên (ý tưởng, cài đặt, thư viện).

import { z } from "zod";

const tempo = z.enum(["slow", "mid", "fast"]);

export const zIdea = z.object({
  id: z.string().trim().min(1, "thiếu id"),
  world_location: z.string().trim().min(1, "thiếu world_location"),
  theme_code: z.string().trim().min(1, "thiếu theme_code"),
  theme_name: z.string().optional(),
  outline: z.string().trim().min(1, "thiếu outline"),
  song_title: z.string().optional(),
  duration_sec: z.number().int().min(10).max(1200).optional(),
  bpm: z.number().min(30).max(300).optional(),
  tempo: tempo.optional(),
  lyrics: z.string().optional(),
  series: z.string().optional(),
});

export const zTone = z.enum(["default", "playful", "melancholy", "cinematic"]);

export const zSettings = z.object({
  model: z.string().trim().min(1),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]),
  useFallback: z.boolean(),
  videoModel: z.string().min(1),
  clipLen: z.number().int().min(3).max(30).nullable(),
  maxShots: z.number().int().min(1).max(200),
  minShots: z.number().int().min(1).max(200),
  loopScenes: z.boolean(),
  defaultDuration: z.number().int().min(10).max(1200),
  stylePreset: z.string().min(1),
  fixedCouple: z.boolean(),
  concurrency: z.number().int().min(1).max(8),
  allowVehicleMakes: z.boolean(),
  channelVoice: z.string(),
  engine: z.enum(["auto", "api", "manual", "demo"]),
  songStructure: z
    .array(z.object({ name: z.string().min(1), ratio: z.number().min(0), role_vi: z.string(), role_en: z.string() }))
    .min(1),
}).refine((s) => s.minShots <= s.maxShots, { message: "Số cảnh tối thiểu phải ≤ số cảnh tối đa", path: ["minShots"] });

export const zEditOptions = z.object({
  mode: z.enum(["full", "beat"]),
  pace: z.enum(["slow", "normal", "fast"]),
  snapBeats: z.boolean(),
  sectionStarts: z.array(z.number().min(0).max(7200)).max(50).nullable(),
  size: z.enum(["1080p", "720p", "shorts"]),
  fit: z.enum(["fill", "fit"]),
  fps: z.union([z.literal(24), z.literal(30)]),
  flipRepeats: z.boolean(),
  fadeIn: z.number().min(0).max(10),
  fadeOut: z.number().min(0).max(10),
  seed: z.number().int().min(0).max(1_000_000),
  quality: z.enum(["youtube", "fast"]),
  loudness: z.object({ enabled: z.boolean(), target_lufs: z.number().min(-30).max(-9), true_peak_dbtp: z.number().min(-6).max(-1) }),
  logo: z.object({
    position: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]),
    size_percent: z.number().min(2).max(50),
    opacity_percent: z.number().min(10).max(100),
    margin_percent: z.number().min(0).max(20),
    shape: z.enum(["original", "circle"]),
    start_seconds: z.number().min(0).max(3600),
  }),
  intro: z.object({
    enabled: z.boolean(),
    title: z.string().max(100),
    subtitle: z.string().max(100),
    seconds: z.number().min(2).max(30),
    background_blur: z.boolean(),
    blur_percent: z.number().min(5).max(100),
  }),
  metadata: z.object({
    artist: z.string().max(200),
    genre: z.string().max(100),
  }),
});

const forbidden = z.object({
  term: z.string().min(1),
  patterns: z.array(z.string()).optional(),
  reason_vi: z.string().optional(),
  label_vi: z.string().optional(),
  case_sensitive: z.boolean().optional(),
});

export const zThemes = z.record(
  z.string().regex(/^[A-Z0-9_-]+$/i, "mã chủ đề chỉ gồm chữ/số"),
  z.looseObject({
    name: z.string().min(1),
    mood: z.string(),
    pacing: tempo,
    signature_shots: z.array(z.string()),
    description_vi: z.string().optional(),
    needs_review: z.boolean().optional(),
  }),
);

export const zLocations = z.record(
  z.string().min(1),
  z.looseObject({
    region: z.string().optional(),
    aliases: z.array(z.string()).optional(),
    landmarks: z.array(z.string()),
    vehicles: z.array(z.string()),
    wardrobe: z.array(z.string()).optional(),
    props: z.array(z.string()),
    light: z.string(),
    notes: z.string().optional(),
    forbidden: z.array(forbidden).optional(),
    auto_generated: z.boolean().optional(),
  }),
);

export const zStyles = z.record(
  z.string().min(1),
  z.looseObject({ name: z.string().min(1), text: z.string().min(1), short: z.string().optional() }),
);

export const zVideoModels = z.record(
  z.string().min(1),
  z.looseObject({
    name: z.string().min(1),
    max_prompt_chars: z.number().int().min(100),
    target_prompt_chars: z.number().int().min(50),
    default_clip_len: z.number().int().min(2).max(60),
    clip_lengths: z.array(z.number()),
    supports_audio: z.boolean(),
    supports_negative_prompt: z.boolean(),
    prompt_style: z.string(),
  }),
);

export const zEraRules = z.looseObject({
  global_forbidden: z.array(forbidden),
  introduced: z.array(z.object({ term: z.string(), year: z.number().int(), patterns: z.array(z.string()) })),
  vehicle_makes: z.array(z.string()),
  brands_and_people: z.array(z.string()),
  on_screen_text_patterns: z.array(z.string()),
  years: z.record(
    z.string().regex(/^19\d\d$/),
    z.looseObject({
      vehicles: z.array(z.string()),
      hairstyles: z.array(z.string()),
      fashion: z.array(z.string()),
      props: z.array(z.string()),
      music_dance: z.array(z.string()),
      notes_vi: z.string().optional(),
    }),
  ),
});

const price = z.number().min(0);
export const zPricing = z.looseObject({
  usd_to_vnd: z.number().min(1),
  updated: z.string().optional(),
  note: z.string().optional(),
  models: z.record(z.string().min(1), z.object({ input: price, output: price, cache_write: price, cache_read: price })),
});

export const LIBRARY_SCHEMAS = {
  themes: zThemes,
  locations: zLocations,
  eraRules: zEraRules,
  styles: zStyles,
  videoModels: zVideoModels,
  pricing: zPricing,
} as const;

/** Kiểm tra regex trong era rules / locations có biên dịch được không. */
export function invalidPatterns(patterns: string[]): string[] {
  return patterns.filter((p) => {
    try {
      new RegExp(p);
      return false;
    } catch {
      return true;
    }
  });
}

export const zCharacters = z.array(
  z.object({
    id: z.string().trim().min(1),
    role: z.string(),
    description: z.string().trim().min(10, "mô tả nhân vật quá ngắn"),
    reference_images: z.array(z.string()).optional(),
  }),
);
