// Ước tính nhịp (BPM) và vị trí phách của bài hát từ tín hiệu âm thanh mono.
// Giả định tempo đều suốt bài (đúng với phần lớn nhạc tạo bằng AI / thu theo click).

export interface BeatInfo {
  bpm: number;
  /** Thời điểm phách đầu tiên, trong khoảng [0, 60/bpm). */
  offset: number;
  /** 0–1: phách càng rõ (trống, tiếng vỗ) thì càng cao. */
  confidence: number;
}

const MIN_BPM = 60;
const MAX_BPM = 200;

/** Đường bao "điểm bật" (onset): năng lượng tăng đột ngột ở mỗi khung ~12 ms. */
export function onsetEnvelope(samples: Float32Array, sampleRate: number, hop = 128): { env: Float32Array; hopSec: number } {
  const frames = Math.floor(samples.length / hop);
  const energy = new Float32Array(frames);
  let prev = 0;
  for (let i = 0; i < frames; i++) {
    let e = 0;
    for (let j = i * hop, end = j + hop; j < end; j++) {
      // Lọc thông cao đơn giản để nhấn tiếng trống / snare.
      const y = samples[j] - 0.97 * prev;
      prev = samples[j];
      e += y * y;
    }
    energy[i] = e;
  }
  // Năng lượng trên cửa sổ 4 khung, nén log để tiếng nhỏ vẫn có đóng góp.
  const logE = new Float32Array(frames);
  let run = 0;
  for (let i = 0; i < frames; i++) {
    run += energy[i] - (i >= 4 ? energy[i - 4] : 0);
    logE[i] = Math.log1p(1000 * Math.max(0, run));
  }
  const raw = new Float32Array(frames);
  for (let i = 1; i < frames; i++) raw[i] = Math.max(0, logE[i] - logE[i - 1]);

  // Trừ trung bình cục bộ (±0.25 s) để bỏ phần nền.
  const hopSec = hop / sampleRate;
  const half = Math.max(1, Math.round(0.25 / hopSec));
  const prefix = new Float64Array(frames + 1);
  for (let i = 0; i < frames; i++) prefix[i + 1] = prefix[i] + raw[i];
  const env = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(frames, i + half + 1);
    env[i] = Math.max(0, raw[i] - (prefix[b] - prefix[a]) / (b - a));
  }
  return { env, hopSec };
}

function sampleAt(env: Float32Array, x: number): number {
  const i = Math.floor(x);
  if (i < 0 || i + 1 >= env.length) return 0;
  const f = x - i;
  return env[i] * (1 - f) + env[i + 1] * f;
}

/** Điểm khớp của lưới phách (chu kỳ `period`, lệch pha `phase`, đơn vị khung). */
function combScore(env: Float32Array, period: number, phase: number): number {
  let sum = 0;
  let n = 0;
  for (let x = phase; x < env.length - 1; x += period) {
    // Lấy cực đại trong ±1 khung để chịu được sai số nhỏ của từng phách.
    sum += Math.max(sampleAt(env, x - 1), sampleAt(env, x), sampleAt(env, x + 1));
    n++;
  }
  return n ? sum / n : 0;
}

function bestPhase(env: Float32Array, period: number): { phase: number; score: number; mean: number } {
  let best = { phase: 0, score: -1 };
  let total = 0;
  let count = 0;
  for (let phase = 0; phase < period; phase += 0.5) {
    const score = combScore(env, period, phase);
    total += score;
    count++;
    if (score > best.score) best = { phase, score };
  }
  return { ...best, mean: count ? total / count : 0 };
}

/**
 * Tìm BPM + phách đầu tiên. `fixedBpm` = người dùng đã biết BPM, chỉ cần tìm vị trí phách.
 * Trả về null nếu bài quá ngắn hoặc không nhận ra nhịp.
 */
export function detectBeats(samples: Float32Array, sampleRate: number, fixedBpm?: number | null): BeatInfo | null {
  const { env, hopSec } = onsetEnvelope(samples, sampleRate);
  if (env.length * hopSec < 4) return null;
  let mean = 0;
  for (let i = 0; i < env.length; i++) mean += env[i];
  mean /= env.length;
  if (mean <= 1e-9) return null;

  let period: number;
  if (fixedBpm && fixedBpm >= 30 && fixedBpm <= 300) {
    period = 60 / fixedBpm / hopSec;
  } else {
    // 1) Tự tương quan, ưu tiên nhẹ vùng quanh 120 BPM (σ = 1 quãng tám).
    const lagMin = Math.floor(60 / MAX_BPM / hopSec);
    const lagMax = Math.ceil(60 / MIN_BPM / hopSec);
    let bestLag = 0;
    let bestVal = -1;
    // Làm mượt đường bao để chu kỳ không nguyên (vd. 37,4 khung) vẫn khớp.
    const smooth = new Float32Array(env.length);
    const kernel = [1, 2, 3, 2, 1];
    for (let i = 0; i < env.length; i++) {
      let v = 0;
      for (let k = -2; k <= 2; k++) v += (env[i + k] ?? 0) * kernel[k + 2];
      smooth[i] = v / 9;
    }
    const ac = new Float64Array(lagMax + 2);
    for (let lag = lagMin; lag <= lagMax + 1; lag++) {
      let s = 0;
      for (let i = 0; i + lag < smooth.length; i++) s += smooth[i] * smooth[i + lag];
      ac[lag] = s / (smooth.length - lag);
    }
    for (let lag = lagMin; lag <= lagMax; lag++) {
      const bpm = 60 / (lag * hopSec);
      const w = Math.exp(-0.5 * Math.log2(bpm / 120) ** 2);
      const v = ac[lag] * w;
      if (v > bestVal) {
        bestVal = v;
        bestLag = lag;
      }
    }
    if (!bestLag) return null;
    // 2) Tinh chỉnh chu kỳ bằng lưới phách trên cả bài (sai số nhỏ cộng dồn rất nhanh qua vài trăm phách).
    period = bestLag;
    let bestScore = -1;
    for (let d = -0.04; d <= 0.04 + 1e-9; d += 0.0005) {
      const p = bestLag * (1 + d);
      const { score } = bestPhase(env, p);
      if (score > bestScore) {
        bestScore = score;
        period = p;
      }
    }
  }

  const { phase, score, mean: phaseMean } = bestPhase(env, period);
  const bpm = 60 / (period * hopSec);
  // Độ tin cậy: lưới đúng pha nổi bật bao nhiêu so với lưới lệch pha.
  const contrast = phaseMean > 0 ? score / phaseMean - 1 : 0;
  const confidence = Math.max(0, Math.min(1, contrast / 1.5));
  return { bpm: Math.round(bpm * 100) / 100, offset: Math.round(phase * hopSec * 1000) / 1000, confidence: Math.round(confidence * 100) / 100 };
}
