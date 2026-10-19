import { NextResponse } from "next/server";
import { listMVs, summarize } from "@/lib/store";

export async function GET() {
  const all = await listMVs();
  return NextResponse.json(all.map(summarize));
}
