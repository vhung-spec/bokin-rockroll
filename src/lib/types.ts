// Kiểu dữ liệu dùng chung cho cả server và client.

export type Tempo = "slow" | "mid" | "fast";
export type ShotClass = "wide" | "medium" | "close";
export type Severity = "error" | "warning" | "info";

/** Một dòng ý tưởng (đơn vị cơ bản người dùng nhập). */
export interface IdeaRow {
  id: string;
  world_location: string;
  theme_code: string;
  theme_name?: string;
  outline: string;
  song_title?: string;
  duration_sec?: number;
  bpm?: number;
  tempo?: Tempo;
  lyrics?: string;
  series?: string;
}

// ---------- Thư viện cấu hình (data/*.json) ----------

export interface Theme {
  name: string;
  mood: string;
  pacing: Tempo;
  signature_shots: string[];
  description_vi?: string;
  needs_review?: boolean;
}
export type ThemeLibrary = Record<string, Theme>;

export interface ForbiddenTerm {
  term: string;
  patterns?: string[];
  reason_vi?: string;
  label_vi?: string;
  case_sensitive?: boolean;
}

export interface LocationData {
  region?: string;
  aliases?: string[];
  landmarks: string[];
  vehicles: string[];
  wardrobe?: string[];
  props: string[];
  light: string;
  notes?: string;
  forbidden?: ForbiddenTerm[];
  auto_generated?: boolean;
}
export type LocationLibrary = Record<string, LocationData>;

export interface EraYear {
  vehicles: string[];
  hairstyles: string[];
  fashion: string[];
  props: string[];
  music_dance: string[];
  notes_vi?: string;
}

export interface IntroducedItem {
  term: string;
  year: number;
  patterns: string[];
}

export interface EraRules {
  global_forbidden: ForbiddenTerm[];
  introduced: IntroducedItem[];
  vehicle_makes: string[];
  brands_and_people: string[];
  on_screen_text_patterns: string[];
  years: Record<string, EraYear>;
}

export interface StylePreset {
  name: string;
  text: string;
  short?: string;
}
export type StyleLibrary = Record<string, StylePreset>;

export interface VideoModelProfile {
  name: string;
  max_prompt_chars: number;
  target_prompt_chars: number;
  default_clip_len: number;
  clip_lengths: number[];
  supports_audio: boolean;
  supports_negative_prompt: boolean;
  prompt_style: string;
}
export type VideoModelLibrary = Record<string, VideoModelProfile>;

export interface SongSection {
  name: string;
  ratio: number;
  role_vi: string;
  role_en: string;
}

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface Settings {
  model: string;
  effort: Effort;
  useFallback: boolean;
  videoModel: string;
  clipLen: number | null;
  maxShots: number;
  minShots: number;
  /** MV sẽ lặp lại các cảnh khi dựng → mỗi cảnh phải độc lập, dùng lại được. */
  loopScenes: boolean;
  defaultDuration: number;
  stylePreset: string;
  fixedCouple: boolean;
  concurrency: number;
  allowVehicleMakes: boolean;
  channelVoice: string;
  mockMode: boolean;
  songStructure: SongSection[];
}

export interface Libraries {
  themes: ThemeLibrary;
  locations: LocationLibrary;
  eraRules: EraRules;
  styles: StyleLibrary;
  videoModels: VideoModelLibrary;
}

// ---------- Nhân vật ----------

export interface Character {
  /** Token viết hoa dùng làm placeholder trong prompt, ví dụ HE → {{HE}} */
  id: string;
  role: string;
  /** Cụm danh từ tiếng Anh, dùng lại NGUYÊN VĂN trong mọi prompt. */
  description: string;
  reference_images?: string[];
}

export interface CharacterBible {
  characters: Character[];
}

// ---------- Cấu trúc bài hát (structure.ts) ----------

export interface PlannedSection {
  name: string;
  start_sec: number;
  end_sec: number;
  duration_sec: number;
  shot_count: number;
  clip_len: number;
  role_vi: string;
  role_en: string;
}

export interface PlannedShot {
  shot_no: number;
  section: string;
  start_sec: number;
  duration_sec: number;
  size_hint: ShotClass;
  must_motion: boolean;
  signature_shot: string | null;
  lyric_line: string | null;
}

export interface StructurePlan {
  duration_sec: number;
  clip_len: number;
  tempo: Tempo;
  bpm: number | null;
  total_shots: number;
  sections: PlannedSection[];
  shots: PlannedShot[];
  notes: string[];
}

// ---------- Kết quả MV ----------

export interface Shot {
  shot_no: number;
  section: string;
  start_sec: number;
  duration_sec: number;
  description_vi: string;
  /** Prompt gốc có placeholder {{HE}} / {{SHE}}, chưa có style. */
  prompt_core: string;
  /** Prompt hoàn chỉnh để dán vào công cụ video. */
  prompt_en: string;
  camera: string;
  shot_size: string;
  characters_in_shot: string[];
  lyric_line: string | null;
  negative_prompt: string;
  transition_to_next: string;
  audio: string | null;
  signature_shot: string | null;
  is_motion: boolean;
  /** true nếu người dùng đã sửa tay prompt_en. */
  edited?: boolean;
}

export interface Issue {
  shot_no: number | null;
  severity: Severity;
  category: "era" | "location" | "text" | "brand" | "length" | "structure" | "language" | "character" | "duplicate";
  message_vi: string;
  term?: string;
}

export interface EditingNote {
  section: string;
  note_vi: string;
}

export interface StoryBeat {
  section: string;
  beat_vi: string;
}

export interface DuplicateReport {
  other_mv_id: string;
  other_title: string;
  similar_pairs: { shot_no: number; other_shot_no: number; score: number; shared: string[] }[];
  ratio: number;
  suggestion_vi: string;
}

export type Tone = "default" | "playful" | "melancholy" | "cinematic";

export interface MVResult {
  id: string;
  created_at: string;
  updated_at: string;
  idea: IdeaRow;
  year: number;
  location_key: string | null;
  location: LocationData;
  theme_code: string;
  theme: Theme;
  tone: Tone;
  generator: "claude" | "mock";
  model: string;
  video_model: string;
  style_key: string;
  style_text: string;
  character_bible: CharacterBible;
  story_arc: StoryBeat[];
  structure: StructurePlan;
  shots: Shot[];
  thumbnail_prompt: string;
  youtube_titles: string[];
  youtube_description: string;
  editing_notes: EditingNote[];
  /** Ghi chú phát sinh lúc sinh (chủ đề/địa điểm chưa có trong thư viện, cảnh được vá...). */
  generation_notes: Issue[];
  issues: Issue[];
  duplicates: DuplicateReport[];
  usage?: { input_tokens: number; output_tokens: number };
}

/** Bản tóm tắt dùng cho trang Lịch sử. */
export interface MVSummary {
  id: string;
  created_at: string;
  updated_at: string;
  idea_id: string;
  song_title: string;
  world_location: string;
  year: number;
  theme_code: string;
  theme_name: string;
  series: string;
  shot_count: number;
  error_count: number;
  warning_count: number;
  generator: "claude" | "mock";
}
