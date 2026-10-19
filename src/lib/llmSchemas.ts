// JSON schema cho structured output của Claude + zod để kiểm tra lại phía client.

import { z } from "zod";

const str = (description: string) => ({ type: "string", description });
const strArray = (description: string) => ({ type: "array", items: { type: "string" }, description });
const nullableStr = (description: string) => ({ anyOf: [{ type: "string" }, { type: "null" }], description });
const obj = (properties: Record<string, unknown>, description?: string) => ({
  type: "object",
  ...(description ? { description } : {}),
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

export const SHOT_SIZES = [
  "extreme wide",
  "wide",
  "full",
  "medium wide",
  "medium",
  "medium close-up",
  "close-up",
  "extreme close-up",
] as const;

const CHARACTER_SCHEMA = obj({
  id: str("Uppercase placeholder token, e.g. HE, SHE, FRIEND"),
  role: str("Short role label in English, e.g. male lead"),
  description: str("English noun phrase starting with a/an: age, hairstyle and hair color, face, main outfit with colors, one signature accessory. No names."),
});

const SHOT_SCHEMA = obj({
  shot_no: { type: "integer", description: "Same number as the shot plan row" },
  shot_size: { type: "string", enum: SHOT_SIZES },
  camera: str("Short English camera movement"),
  characters_in_shot: strArray("Character ids used as {{ID}} placeholders in prompt_core"),
  description_vi: str("One natural Vietnamese sentence describing the shot"),
  prompt_core: str("English prompt without style preset; characters only as {{ID}} placeholders"),
  audio: nullableStr("English sound description when the target model supports audio, else null"),
  negative_extra: strArray("Shot-specific things to avoid, English, may be empty"),
  transition_to_next: str("Short English transition idea to the next shot"),
  signature_shot: nullableStr("The theme signature shot used in this shot (copied from the plan), or null"),
  is_motion: { type: "boolean", description: "true if the shot shows dancing or strong physical movement" },
});

export const GENERATION_SCHEMA = obj({
  character_bible: { type: "array", items: CHARACTER_SCHEMA },
  story_arc: { type: "array", items: obj({ section: str("Section name from the plan"), beat_vi: str("Story beat in Vietnamese") }) },
  shots: { type: "array", items: SHOT_SCHEMA },
  thumbnail_prompt: str("English 16:9 still-image prompt; may use {{ID}} placeholders; no style preset"),
  youtube_titles: strArray("Exactly 3 YouTube title options"),
  youtube_description: str("Short YouTube description in the channel voice"),
  editing_notes: { type: "array", items: obj({ section: str("Section name"), note_vi: str("Editing note in Vietnamese") }) },
});

export const SHOT_REGEN_SCHEMA = obj({ shot: SHOT_SCHEMA });

export const SHORTEN_SCHEMA = obj({
  shots: { type: "array", items: obj({ shot_no: { type: "integer" }, prompt_core: str("Shortened prompt_core") }) },
});

export const LOCATION_SCHEMA = obj({
  landmarks: strArray("4 visual landmark descriptions without brand names or readable text"),
  vehicles: strArray("3-5 period vehicles as 'YEAR Make Model', model year <= scene year"),
  wardrobe: strArray("2-3 period wardrobe descriptions"),
  props: strArray("3-5 period props"),
  light: str("Characteristic light by day and night"),
  notes: str("Short Vietnamese note about pitfalls/anachronisms for this place"),
  forbidden: {
    type: "array",
    items: obj({ term: str("English phrase that must not appear"), reason_vi: str("Vietnamese reason") }),
  },
});

export const COUPLE_SCHEMA = obj({ characters: { type: "array", items: CHARACTER_SCHEMA } });

// ---------- zod: kiểm tra lại dữ liệu trả về ----------

export const zCharacter = z.object({ id: z.string().min(1), role: z.string(), description: z.string().min(10) });

export const zShot = z.object({
  shot_no: z.number().int(),
  shot_size: z.string(),
  camera: z.string(),
  characters_in_shot: z.array(z.string()),
  description_vi: z.string(),
  prompt_core: z.string().min(10),
  audio: z.string().nullable(),
  negative_extra: z.array(z.string()),
  transition_to_next: z.string(),
  signature_shot: z.string().nullable(),
  is_motion: z.boolean(),
});

export const zGeneration = z.object({
  character_bible: z.array(zCharacter),
  story_arc: z.array(z.object({ section: z.string(), beat_vi: z.string() })),
  shots: z.array(zShot).min(1),
  thumbnail_prompt: z.string(),
  youtube_titles: z.array(z.string()),
  youtube_description: z.string(),
  editing_notes: z.array(z.object({ section: z.string(), note_vi: z.string() })),
});

export const zShotRegen = z.object({ shot: zShot });
export const zShorten = z.object({ shots: z.array(z.object({ shot_no: z.number().int(), prompt_core: z.string() })) });
export const zLocation = z.object({
  landmarks: z.array(z.string()),
  vehicles: z.array(z.string()),
  wardrobe: z.array(z.string()),
  props: z.array(z.string()),
  light: z.string(),
  notes: z.string(),
  forbidden: z.array(z.object({ term: z.string(), reason_vi: z.string() })),
});
export const zCouple = z.object({ characters: z.array(zCharacter).min(1) });

export type RawShot = z.infer<typeof zShot>;
export type RawGeneration = z.infer<typeof zGeneration>;
export type RawLocation = z.infer<typeof zLocation>;
