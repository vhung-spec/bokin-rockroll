// Cân bằng âm lượng — chuyển từ Bokin Studio Music (loop_music/loudness.py).
// Chỉ đo (ebur128, true peak) rồi áp một mức gain cố định; không bao giờ dùng tiếng đã qua loudnorm.
// Sau khi mã hoá AAC, đo lại đỉnh trên tiếng đã giải mã; vượt trần thì giảm gain và mã hoá lại (tối đa 3 lần).

import type { LoudnessConfig, LoudnessStats } from "./types";

export const DEFAULT_LOUDNESS: LoudnessConfig = { enabled: true, target_lufs: -14, true_peak_dbtp: -1.5 };
export const MAX_BOOST_DB = 12;
export const AAC_TOLERANCE_DB = 0.1;
export const MAX_AAC_ATTEMPTS = 3;
export const EBUR128_FILTER = "ebur128=peak=true:metadata=1:framelog=quiet";
/** ebur128 báo mức sàn này khi không có khối nào qua cổng (im lặng). */
export const EBUR128_GATE_LUFS = -70;
/** Metadata tuyến tính chỉ có 3 chữ số thập phân: dưới mức này dùng số tổng kết (0.1 dB). */
const METADATA_PEAK_FLOOR = 0.1;
const SUMMARY_ROUNDING_DB = 0.05;

export const LOUDNESS_PRESETS: { value: string; label: string; config: LoudnessConfig }[] = [
  { value: "-14", label: "Chuẩn YouTube (−14 LUFS)", config: { enabled: true, target_lufs: -14, true_peak_dbtp: -1.5 } },
  { value: "-18", label: "Nhẹ hơn (−18 LUFS, mặc định của Bokin Studio Music)", config: { enabled: true, target_lufs: -18, true_peak_dbtp: -1.5 } },
  { value: "off", label: "Tắt — giữ nguyên âm lượng bài", config: { enabled: false, target_lufs: -14, true_peak_dbtp: -1.5 } },
];

export function validateLoudness(value: LoudnessConfig): LoudnessConfig {
  const check = (n: number, name: string, lo: number, hi: number) => {
    if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`${name} phải là số trong [${lo}, ${hi}].`);
    return n;
  };
  return {
    enabled: Boolean(value.enabled),
    target_lufs: check(value.target_lufs, "target_lufs", -30, -9),
    true_peak_dbtp: check(value.true_peak_dbtp, "true_peak_dbtp", -6, -1),
  };
}

/**
 * Đọc kết quả ebur128: metadata của khung cuối (LUFS, true peak tuyến tính 3 chữ số) đối chiếu với phần tổng kết.
 * Im lặng → null (như -inf của loudnorm); thiếu, NaN hoặc mâu thuẫn → lỗi, không bao giờ là một số đo "im lặng".
 */
export function parseEbur128(metadata: string, summary: string): LoudnessStats {
  const values: Record<string, string> = {};
  const at = metadata.lastIndexOf("frame:");
  const block = at >= 0 ? metadata.slice(at) : "";
  for (const line of block.split(/\r?\n/).slice(1)) {
    const i = line.indexOf("=");
    if (i > 0) values[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const peaks = [...summary.matchAll(/^\s*Peak:\s+(\S+)\s+dBFS/gm)];
  const loudnessLines = [...summary.matchAll(/^\s*I:\s+(\S+)\s+LUFS/gm)];
  const num = (s: string | undefined) => (s === "-inf" ? -Infinity : s === "inf" ? Infinity : Number(s));
  if (!peaks.length) throw new Error("Thiếu hoặc hỏng số đo ebur128 (summary).");
  const summaryPeak = num(peaks.at(-1)![1]);
  let integrated: number;
  let linear: number | null;
  if (block) {
    if (!("lavfi.r128.I" in values) || !("lavfi.r128.true_peak" in values)) throw new Error("Thiếu số đo ebur128 (I hoặc true peak).");
    integrated = num(values["lavfi.r128.I"]);
    linear = num(values["lavfi.r128.true_peak"]);
  } else {
    // Tiếng ngắn hơn một khung 100 ms không có metadata; phần tổng kết vẫn phủ mọi mẫu.
    if (!loudnessLines.length) throw new Error("Thiếu số đo ebur128 (I).");
    integrated = num(loudnessLines.at(-1)![1]);
    linear = null;
  }
  if (Number.isNaN(integrated) || integrated === Infinity || Number.isNaN(summaryPeak) || summaryPeak === Infinity || (linear !== null && (!Number.isFinite(linear) || linear < 0))) {
    throw new Error("Số đo ebur128 chứa NaN, +Infinity hoặc đỉnh âm.");
  }
  const I = integrated <= EBUR128_GATE_LUFS ? null : integrated;
  let peak: number | null;
  if (linear === null) peak = summaryPeak === -Infinity ? null : summaryPeak;
  else if (linear >= METADATA_PEAK_FLOOR) {
    peak = 20 * Math.log10(linear);
    // Phần tổng kết còn tính cả các mẫu xả ra từ bộ oversample sau khung cuối.
    if (summaryPeak > peak + SUMMARY_ROUNDING_DB) peak = summaryPeak;
  } else if (summaryPeak === -Infinity) {
    if (linear > 0) throw new Error("Số đo ebur128 mâu thuẫn: metadata có đỉnh nhưng summary im lặng.");
    peak = null;
  } else peak = summaryPeak;
  if (I !== null && peak === null) throw new Error("Số đo loudness hữu hạn nhưng true peak im lặng: thống kê mâu thuẫn.");
  return { integrated_lufs: I, true_peak_dbtp: peak };
}

export interface GainDecision {
  desired_gain_db: number | null;
  peak_allowed_gain_db: number | null;
  applied_gain_db: number;
  peak_limited: boolean;
  boost_limited: boolean;
  target_reached: boolean;
}

/** gain = min(mục tiêu − I, trần − TP, 12 dB). Không bao giờ nâng lặp lại để ép đạt mục tiêu. */
export function gainDecision(stats: LoudnessStats, config: LoudnessConfig): GainDecision {
  const { integrated_lufs: I, true_peak_dbtp: TP } = stats;
  const desired = I !== null ? config.target_lufs - I : null;
  const allowed = TP !== null ? config.true_peak_dbtp - TP : null;
  if (desired !== null && allowed === null) throw new Error("Thiếu true peak cho bài đo được loudness.");
  const gain = Math.min(desired ?? 0, allowed ?? 0, MAX_BOOST_DB);
  const peakLimited = allowed !== null && allowed < (desired ?? 0) - 1e-9 && allowed <= MAX_BOOST_DB;
  const boostLimited = desired !== null && desired > MAX_BOOST_DB + 1e-9 && (allowed === null || allowed >= MAX_BOOST_DB);
  return {
    desired_gain_db: desired,
    peak_allowed_gain_db: allowed,
    applied_gain_db: gain,
    peak_limited: peakLimited,
    boost_limited: boostLimited,
    target_reached: I !== null && !peakLimited && !boostLimited,
  };
}

/** null = AAC đạt; nếu không, trả về gain (cộng dồn, tính từ bản gốc) cho lần mã hoá sau. */
export function retryGain(tp: number | null, ceiling: number, current: number, attempt: number): number | null {
  if (tp === null) return null;
  if (tp <= ceiling + AAC_TOLERANCE_DB + 1e-9) return null;
  if (attempt >= MAX_AAC_ATTEMPTS) throw new Error("Tiếng AAC vẫn vượt trần true peak sau 3 lần mã hoá — không xuất video.");
  return current - (tp - ceiling + AAC_TOLERANCE_DB);
}

/** Gain cố định, độ chính xác double, tính một lần (bỏ ReplayGain trong file). */
export function volumeFilter(gainDb: number): string {
  const multiplier = 10 ** (gainDb / 20);
  return `volume=${multiplier.toPrecision(17)}:precision=double:eval=once:replaygain=drop`;
}
