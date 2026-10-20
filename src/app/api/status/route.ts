import { NextResponse } from "next/server";
import { generationMode } from "@/lib/generate";
import { hasCredentials } from "@/lib/llm";
import { museOpen } from "@/lib/muse";
import { ensureMuseWatch, readMuse } from "@/lib/museJobs";
import { readQueue } from "@/lib/queue";
import { listDrafts, readLibraries, readSettings } from "@/lib/store";

export async function GET() {
  const settings = await readSettings();
  const libs = await readLibraries();
  const profile = libs.videoModels[settings.videoModel];
  const drafts = await listDrafts();
  const queue = await readQueue();
  const muse = await readMuse();
  // Thanh menu gọi mỗi lần đổi trang: app vừa mở lại thì dò HaoHao tiếp cho các cảnh đang làm.
  if (muse.mvs.length) ensureMuseWatch(false);
  return NextResponse.json({
    mode: generationMode(settings),
    engine: settings.engine,
    hasKey: hasCredentials(),
    model: settings.model,
    effort: settings.effort,
    videoModel: settings.videoModel,
    videoModelName: profile?.name ?? settings.videoModel,
    clipLen: settings.clipLen ?? profile?.default_clip_len ?? 8,
    minShots: settings.minShots,
    defaultDuration: settings.defaultDuration,
    maxShots: settings.maxShots,
    concurrency: settings.concurrency,
    fixedCouple: settings.fixedCouple,
    price: libs.pricing.models?.[settings.model] ?? null,
    usdToVnd: libs.pricing.usd_to_vnd ?? 26000,
    pendingDrafts: drafts.length,
    /** Số MV đang chờ / đang dựng trong hàng chờ dựng video. */
    renderQueue: queue.items.filter((i) => i.status === "waiting" || i.status === "running").length,
    renderQueueRunning: queue.running,
    /** Số cảnh đang tạo clip bằng Muse (chờ dán / đang làm / lỗi). */
    museOpen: museOpen(muse),
  });
}
