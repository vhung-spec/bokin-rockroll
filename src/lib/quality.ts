// Thiết lập mã hoá khi xuất MV. Preset "youtube" chuyển từ Bokin Studio Music (loop_music/quality.py):
// H.264 High, gắn màu BT.709, keyframe mỗi nửa giây, giới hạn bitrate theo bảng upload SDR của YouTube, AAC 384 kbps.

import type { QualityPreset } from "./types";

export const YOUTUBE_CRF = 17;
/** Bitrate upload SDR khuyến nghị của YouTube (Mbit/s): (chiều cao tối thiểu, 24–30 fps, 48–60 fps). */
export const YOUTUBE_MBPS: [number, number, number][] = [
  [2160, 45, 68],
  [1440, 16, 24],
  [1080, 8, 12],
  [720, 5, 7.5],
  [480, 2.5, 4],
  [0, 1, 1.5],
];
/** Bảng trên là mức tối thiểu; dưới 4K cho phép cao hơn một nửa. */
export const YOUTUBE_HEADROOM = 1.5;

export const AUDIO_BITRATE: Record<QualityPreset, string> = { youtube: "384k", fast: "256k" };

export const QUALITY_LABEL: Record<QualityPreset, string> = {
  youtube: "YouTube — đẹp nhất (như Bokin Studio), dựng lâu hơn",
  fast: "Nhanh — để xem thử",
};

/** Giới hạn bitrate (bit/s) cho video YouTube ở chiều cao và fps này. */
export function youtubeMaxrate(height: number, fps: number): number {
  for (const [minimum, normal, high] of YOUTUBE_MBPS) {
    if (height >= minimum) {
      const mbps = fps > 31 ? high : normal;
      return Math.round(mbps * 1_000_000 * (minimum >= 2160 ? 1 : YOUTUBE_HEADROOM));
    }
  }
  throw new Error("unreachable");
}

/**
 * Tham số libx264, giống hệt nhau cho mọi đoạn để SPS/PPS trùng khớp và nối được bằng stream copy.
 * Không dùng B-frame (như Bokin Studio Music): mỗi đoạn bắt đầu bằng keyframe, mốc thời gian tăng đều.
 */
export function videoEncoderArgs(preset: QualityPreset, outHeight: number, fps: number): string[] {
  if (preset === "youtube") {
    const cap = youtubeMaxrate(outHeight, fps);
    return [
      "-c:v", "libx264", "-preset", "medium", "-crf", String(YOUTUBE_CRF),
      "-maxrate", String(cap), "-bufsize", String(2 * cap),
      "-pix_fmt", "yuv420p", "-bf", "0", "-g", String(Math.max(1, Math.round(fps / 2))),
      "-profile:v", "high", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
    ];
  }
  return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-bf", "0", "-g", String(fps * 2)];
}
