import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, readJsonBody } from "@/lib/http";
import { zCharacters } from "@/lib/schemas";
import { readCouples, writeCouples } from "@/lib/store";

export async function GET() {
  return NextResponse.json(await readCouples());
}

/** Ghi đè toàn bộ danh sách cặp đôi cố định theo series. */
export async function PUT(req: Request) {
  try {
    const data = z
      .record(z.string().min(1), z.object({ characters: zCharacters, created_at: z.string().optional() }))
      .parse(await readJsonBody(req));
    const now = new Date().toISOString();
    const normalized = Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, { characters: v.characters, created_at: v.created_at ?? now }]),
    );
    await writeCouples(normalized);
    return NextResponse.json(normalized);
  } catch (err) {
    return errorResponse(err);
  }
}
