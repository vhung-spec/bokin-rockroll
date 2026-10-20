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

/**
 * Cách sinh nội dung:
 * - auto: có API key thì gọi Claude API, không có thì dùng claude.ai (thủ công)
 * - api: luôn gọi Claude API
 * - manual: copy yêu cầu sang claude.ai rồi dán câu trả lời lại (không tốn phí API)
 * - demo: ghép từ mẫu có sẵn, không dùng AI
 */
export type Engine = "auto" | "api" | "manual" | "demo";

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
  engine: Engine;
  songStructure: SongSection[];
  /** Cách gửi cảnh sang Muse: "gateway" = Cổng Muse tự gửi; "haohao" = copy prompt để dán vào HaoHao. */
  museMode: "gateway" | "haohao";
  /** Địa chỉ Cổng Muse (chỉ trên máy này). */
  museGatewayUrl: string;
  /** Thư mục dữ liệu của tool HaoHao (chứa tasks.json); "" = tự tìm. */
  museDataDir: string;
  /** MV đủ clip Muse + có bài hát → tự thêm vào hàng chờ dựng và chạy. */
  museAutoRender: boolean;
  /** Ghép negative prompt vào cuối chữ gửi Muse ("Avoid: …") vì Muse không có ô negative riêng. */
  museAvoid: boolean;
}

export interface Libraries {
  themes: ThemeLibrary;
  locations: LocationLibrary;
  eraRules: EraRules;
  styles: StyleLibrary;
  videoModels: VideoModelLibrary;
  pricing: Pricing;
}

/** Giá Claude API, USD cho 1 triệu token. */
export interface ModelPrice {
  input: number;
  output: number;
  cache_write: number;
  cache_read: number;
}

export interface Pricing {
  usd_to_vnd: number;
  models: Record<string, ModelPrice>;
  updated?: string;
  note?: string;
}

/** Token đã dùng (cộng dồn qua các lần gọi) và chi phí quy đổi tại thời điểm gọi. */
export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  requests?: number;
  cost_usd?: number;
  /** true nếu có lần gọi dùng model không có trong bảng giá. */
  cost_unknown?: boolean;
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
  generator: "claude" | "mock" | "manual";
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
  usage?: Usage;
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
  generator: "claude" | "mock" | "manual";
  cost_usd: number;
}

/** MV đang chờ câu trả lời từ claude.ai (chế độ thủ công). */
export interface Draft {
  id: string;
  created_at: string;
  idea: IdeaRow;
  tone: Tone;
  /** Ngữ cảnh đã dùng để tạo yêu cầu — câu trả lời được ghép theo đúng ngữ cảnh này. */
  ctx?: unknown;
  notes?: Issue[];
  prompt_built_at?: string;
  prompt_chars?: number;
}

// ---------- Ghép video với nhạc ----------

/** Một file đã tải lên, lưu trong data/media/<mvId>/. */
export interface MediaFile {
  file: string;
  /** Tên gốc của file người dùng chọn. */
  name: string;
  size: number;
  duration: number;
  width?: number;
  height?: number;
  /** Ma trận màu của clip (bt601 cho nguồn SD / smpte170m) — dùng khi đổi sang BT.709. */
  color_matrix?: "bt601" | "bt709";
  /** Số kênh tiếng (bài hát mono được nhân đôi đúng mức, không bị nhỏ đi 3 dB). */
  channels?: number;
  uploaded_at: string;
  /** Thư mục chứa file nếu không phải của MV đang dựng (vd. logo trong thiết lập chung "_shared"). */
  owner?: string;
}

export interface AudioTrack extends MediaFile {
  /** Nhịp của bài (ước tính, coi như tempo đều) — null nếu không nhận ra. */
  bpm: number | null;
  bpm_source: "auto" | "manual";
  /** Thời điểm phách đầu tiên (giây). */
  beat_offset: number;
  /** Độ tin cậy của nhịp ước tính, 0–1. */
  beat_confidence: number;
  /** Ảnh dạng sóng âm (PNG) để hiển thị dưới timeline. */
  waveform?: string;
}

export type CutPace = "slow" | "normal" | "fast";
export type EditMode = "full" | "beat";
export type RenderSize = "1080p" | "720p" | "shorts";

export interface EditOptions {
  /**
   * full = ghép nguyên từng clip theo thứ tự cảnh, hết lượt thì lặp lại cho tới hết bài (không cắt nhỏ clip);
   * beat = cắt clip thành nhiều nhát ngắn theo nhịp nhạc và đoạn của bài.
   */
  mode: EditMode;
  /** Nhịp cắt cảnh (chế độ beat). */
  pace: CutPace;
  /** Cắt đúng phách nhạc (khi nhận ra nhịp). */
  snapBeats: boolean;
  /** Mốc bắt đầu từng đoạn của bài (giây) — null = tự chia theo khung bài hát. */
  sectionStarts: number[] | null;
  size: RenderSize;
  /** fill = cắt cho đầy khung, fit = giữ nguyên khung, thêm viền đen. */
  fit: "fill" | "fit";
  fps: 24 | 30;
  /** Lật ngang các lần lặp lại của một clip để đỡ nhàm. */
  flipRepeats: boolean;
  fadeIn: number;
  fadeOut: number;
  /** 0 = theo thứ tự storyboard; số khác = xáo thứ tự lặp. */
  seed: number;
  /** youtube = theo khuyến nghị upload của YouTube (như Bokin Studio Music); fast = dựng nhanh để xem thử. */
  quality: QualityPreset;
  loudness: LoudnessConfig;
  logo: LogoLayout;
  intro: IntroConfig;
  metadata: VideoMetadata;
}

export type QualityPreset = "youtube" | "fast";

/** Cân bằng âm lượng (theo Bokin Studio Music): đo rồi áp một mức gain cố định, không nén. */
export interface LoudnessConfig {
  enabled: boolean;
  target_lufs: number;
  true_peak_dbtp: number;
}

export type LogoPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";

/** Cách đặt logo kênh ở góc (file logo nằm trong VideoProject.logo). */
export interface LogoLayout {
  position: LogoPosition;
  size_percent: number;
  opacity_percent: number;
  margin_percent: number;
  shape: "original" | "circle";
  start_seconds: number;
}

/** Intro tiêu đề: nền mờ dần từ đen, tiêu đề + dòng phụ hiện rồi tắt (kiểu "title" của Bokin Studio Music). */
export interface IntroConfig {
  enabled: boolean;
  /** Để trống = dùng tên bài hát. */
  title: string;
  subtitle: string;
  seconds: number;
  background_blur: boolean;
  blur_percent: number;
}

/**
 * Thông tin video chọn một lần cho mọi MV (tên kênh, thể loại).
 * Tiêu đề, mô tả, từ khoá và năm được điền tự động cho từng MV (xem Mp4Tags).
 */
export interface VideoMetadata {
  artist: string;
  genre: string;
}

/** Thông tin thật ghi vào file MP4 của một MV (Windows Explorer đọc được). */
export interface Mp4Tags {
  /** Gợi ý tiêu đề YouTube số 1 lúc dựng kịch bản (không có thì tên bài). */
  title: string;
  /** Mô tả YouTube gợi ý lúc dựng kịch bản. */
  description: string;
  /** Hashtag trong mô tả. */
  keywords: string[];
  artist: string;
  genre: string;
  year: string;
}

export interface LoudnessStats {
  integrated_lufs: number | null;
  true_peak_dbtp: number | null;
}

export interface LoudnessReport {
  config: LoudnessConfig;
  before: LoudnessStats;
  desired_gain_db: number | null;
  peak_allowed_gain_db: number | null;
  applied_gain_db: number;
  peak_limited: boolean;
  boost_limited: boolean;
  target_reached: boolean;
  /** Mỗi lần mã hoá AAC: đỉnh đo trên tiếng đã giải mã, có đạt không. */
  aac_attempts: { attempt: number; gain_db: number; true_peak_dbtp: number | null; integrated_lufs: number | null; accepted: boolean }[];
  final_gain_db: number;
}

export interface Verification {
  target_seconds: number;
  video_seconds: number;
  audio_seconds: number;
  video_frames: number;
  expected_frames: number;
  video_codec: string;
  audio_codec: string;
  passed: boolean;
}

export interface RenderInfo {
  file: string;
  created_at: string;
  size: number;
  duration: number;
  resolution: string;
  segments: number;
  seconds_taken: number;
  quality?: QualityPreset;
  loudness?: LoudnessReport | null;
  verification?: Verification;
  branding?: { logo: boolean; intro: boolean };
  /** Thông tin đã ghi vào file. */
  tags?: Mp4Tags;
  /** Tên file khi tải về (theo tiêu đề YouTube — YouTube lấy tên file làm tiêu đề mặc định khi upload). */
  download_name?: string;
}

export interface VideoProject {
  mv_id: string;
  audio: AudioTrack | null;
  /** Clip theo số cảnh (key = shot_no). */
  clips: Record<string, MediaFile>;
  /** Logo kênh (ảnh) và font chữ cho intro (không bắt buộc). */
  logo: MediaFile | null;
  font: MediaFile | null;
  options: EditOptions;
  renders: RenderInfo[];
  updated_at: string;
}

export type SectionType = "intro" | "verse" | "pre" | "chorus" | "final" | "bridge" | "outro" | "other";

export interface EditSection {
  name: string;
  type: SectionType;
  start: number;
  end: number;
}

/** Một đoạn cắt trên timeline: lấy clip của cảnh `shot_no` từ giây `in_point`. */
export interface EditSegment {
  start_frame: number;
  frames: number;
  start: number;
  duration: number;
  shot_no: number;
  in_point: number;
  flip: boolean;
  /** Lần dùng thứ mấy của clip này (0 = lần đầu). */
  use: number;
  section_index: number;
}

export interface EditPlan {
  fps: number;
  duration: number;
  total_frames: number;
  /** Độ dài một phách (giây) nếu cắt theo nhịp. */
  beat: number | null;
  sections: EditSection[];
  segments: EditSegment[];
  /** Số lần dùng và tổng thời lượng của mỗi cảnh. */
  uses: Record<string, { count: number; seconds: number }>;
  /** Chế độ full: độ dài một vòng (mọi clip phát một lần) và số vòng phủ hết bài. */
  round_seconds?: number;
  rounds?: number;
  warnings: string[];
}

export interface RenderJob {
  id: string;
  mv_id: string;
  status: "running" | "done" | "error" | "cancelled";
  progress: number;
  stage: string;
  started_at: string;
  finished_at?: string;
  error?: string;
  output?: RenderInfo;
}
