import { NextResponse } from "next/server";
import { generationMode } from "@/lib/generate";
import { hasCredentials } from "@/lib/llm";
import { readLibraries, readSettings } from "@/lib/store";

export async function GET() {
  const settings = await readSettings();
  const libs = await readLibraries();
  const profile = libs.videoModels[settings.videoModel];
  return NextResponse.json({
    mode: generationMode(settings),
    hasKey: hasCredentials(),
    mockForced: settings.mockMode || process.env.MOCK_LLM === "1",
    model: settings.model,
    videoModel: settings.videoModel,
    videoModelName: profile?.name ?? settings.videoModel,
    clipLen: settings.clipLen ?? profile?.default_clip_len ?? 8,
    concurrency: settings.concurrency,
    fixedCouple: settings.fixedCouple,
  });
}
