import { NextResponse } from "next/server";
import { keySource, maskKey, removeApiKey, saveApiKey } from "@/lib/apikey";
import { errorResponse, readJsonBody } from "@/lib/http";

// Chỉ trả về key đã che (không bao giờ trả key đầy đủ về trình duyệt).
export async function GET() {
  return NextResponse.json({ hasKey: Boolean(process.env.ANTHROPIC_API_KEY), masked: maskKey(process.env.ANTHROPIC_API_KEY), source: await keySource() });
}

export async function PUT(req: Request) {
  try {
    const { key } = await readJsonBody<{ key?: string }>(req);
    await saveApiKey(String(key ?? ""));
    return NextResponse.json({ hasKey: true, masked: maskKey(process.env.ANTHROPIC_API_KEY), source: "env.local" });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE() {
  try {
    await removeApiKey();
    return NextResponse.json({ hasKey: Boolean(process.env.ANTHROPIC_API_KEY), masked: maskKey(process.env.ANTHROPIC_API_KEY), source: await keySource() });
  } catch (err) {
    return errorResponse(err);
  }
}
